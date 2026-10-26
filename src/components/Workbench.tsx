'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { analyse, heldOutPairs, pseudonymise, splitHoldout } from '../lib/chats/analyse';
import type { ChatStats, HeldOutPair } from '../lib/chats/types';
import { api, type ApiError, keyStore, packStore } from '../lib/client/api';
import { useModels } from '../lib/client/useModels';
import { estimateCost, estimateRun, formatCost, formatTokens } from '../lib/client/estimate';
import { draftFromFile, draftMessages, type Draft } from '../lib/client/drafts';
import { phase1Chunks, type Phase1Mode } from '../lib/pipeline/phase1';
import type { Questionnaire } from '../lib/schema/questionnaire';
import type { PackFile } from '../lib/soul/pack';
import { ChatCard } from './ChatCard';
import { FidelityPanel } from './FidelityPanel';
import { QuestionCard } from './QuestionCard';
import { KeyPanel, ModelsPanel, useOpenPanels } from './Settings';
import { Seg } from './ui';

type Stage = 'chats' | 'running' | 'questions' | 'soul' | 'done';

interface Lane {
  id: string;
  label: string;
  value: number;
  bad?: boolean;
}

interface ComposeResponse {
  markdown: string;
  files: PackFile[];
  issues: Array<{ slot: string; rule: string; detail: string }>;
  poolIssues: Array<{ pool: string; detail: string }>;
}

interface Phase1Response {
  markdown: string;
}

interface Phase2Response {
  markdown: string;
  report: {
    sketches: Array<{ index: number; situation: string; drive: string }>;
    drives: Array<{ id: string; drive: string; sources: string[] }>;
    ledger: Array<{ confidence: 'low' | 'medium' | 'high' }>;
  };
}

interface Phase3aResponse {
  questionnaire: Questionnaire;
}

const STEPS = ['chats', 'running', 'questions', 'soul', 'done'];

export function Workbench() {
  const [key, setKey] = useState('');
  useEffect(() => {
    setKey(keyStore.get());
  }, []);

  const modelState = useModels();
  const panels = useOpenPanels({ key: true, models: true });
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<'report' | 'files' | 'log'>('report');
  const [fileIndex, setFileIndex] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dropError, setDropError] = useState('');
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<Phase1Mode>('one-shot');
  const [stage, setStage] = useState<Stage>('chats');
  const [error, setError] = useState('');
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [questions, setQuestions] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [result, setResult] = useState<ComposeResponse | null>(null);
  const [heldOut, setHeldOut] = useState<HeldOutPair[]>([]);
  const [subjectMessages, setSubjectMessages] = useState<string[]>([]);
  const [sketches, setSketches] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Array<'low' | 'medium' | 'high'>>([]);
  const [report, setReport] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);

  const ready = consent && drafts.length > 0 && drafts.every(draft => draft.subject && draft.messages.length > 1);
  const step = STEPS.indexOf(stage);

  function setLane(id: string, value: number, bad = false) {
    setLanes(current => current.map(lane => (lane.id === id ? { ...lane, value, bad } : lane)));
  }

  function reset() {
    setDrafts([]);
    setConsent(false);
    setStage('chats');
    setError('');
    setLanes([]);
    setQuestions(null);
    setAnswers({});
    setQIndex(0);
    setResult(null);
    setHeldOut([]);
    setSubjectMessages([]);
    setSketches([]);
    setDrives([]);
    setConfidence([]);
    setReport('');
    packStore.clear();
  }

  async function addFiles(files: FileList | File[]) {
    setDropError('');
    const room = 6 - drafts.length;
    const chosen = [...files].slice(0, Math.max(0, room));
    if (!chosen.length) return;
    const added: Draft[] = [];
    for (const file of chosen) {
      try {
        added.push(draftFromFile(file.name, await file.text()));
      } catch (parseError) {
        setDropError(parseError instanceof Error ? parseError.message : 'could not read that file');
      }
    }
    setDrafts(current => [...current, ...added]);
  }

  function addLog(line: string) {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setLog(current => [...current, `${stamp}  ${line}`]);
  }

  async function build() {
    if (running.current || !ready) return;
    running.current = true;
    setError('');
    setStage('running');
    addLog(`Building ${drafts.length} engram${drafts.length === 1 ? '' : 's'}${mode === 'one-shot' ? ', one shot per chat' : ''}.`);
    const chats = drafts.map((draft, i) => ({ draft, label: `chat-${i + 1}` }));
    setLanes([
      ...chats.map(chat => ({ id: chat.draft.id, label: chat.label, value: 0 })),
      { id: 'merge', label: 'merge', value: 0 },
      { id: 'questions', label: 'questions', value: 0 },
      { id: 'soul', label: 'soul', value: 0 },
    ]);

    try {
      const pairs: HeldOutPair[] = [];
      const subject: string[] = [];
      const statsByChat: ChatStats[] = [];

      const engrams = await Promise.all(
        chats.map(async (chat, chatIndex) => {
          try {
            const messages = draftMessages(chat.draft);
            const { training, heldout } = splitHoldout(messages);
            const pseudoTraining = pseudonymise(training, chat.draft.subject);
            statsByChat[chatIndex] = analyse(pseudoTraining, chat.draft.subject);
            const pseudoHoldout = pseudonymise(heldout, chat.draft.subject);
            const chunks = phase1Chunks(pseudoTraining, mode);
            let finished = 0;
            if (chunks.length === 1) setLane(chat.draft.id, 10);

            const parts = await Promise.all(
              chunks.map(async (chunk, ci) => {
                const response = await api<Phase1Response>('/api/phase1', key, {
                  chat: chat.label,
                  relationship: chat.draft.relationship,
                  subject: chat.draft.subject,
                  messages: chunk,
                  stats: analyse(chunk, chat.draft.subject),
                  mode,
                  chunk: chunks.length > 1 ? { index: ci + 1, count: chunks.length } : undefined,
                });
                finished += 1;
                if (chunks.length > 1) setLane(chat.draft.id, Math.round((finished / chunks.length) * 80));
                return response.markdown;
              }),
            );

            let engram = parts[0];
            if (chunks.length > 1) {
              setLane(chat.draft.id, 90);
              const merged = await api<{ markdown: string }>('/api/phase1-merge', key, {
                chat: chat.label,
                engrams: parts,
              });
              engram = merged.markdown;
            }

            const pairSource = heldout.length ? pseudoHoldout : pseudoTraining;
            const found = heldOutPairs(pairSource, chat.draft.subject, 20);
            pairs.push(...(found.length ? found : heldOutPairs(pseudoTraining, chat.draft.subject, 20)));
            subject.push(
              ...pseudoTraining.filter(message => message.sender === chat.draft.subject).map(message => message.text),
            );
            setLane(chat.draft.id, 100);
            return engram;
          } catch (chatError) {
            const message = chatError instanceof Error ? chatError.message : 'phase 1 failed';
            setDrafts(current => current.map(item => (item.id === chat.draft.id ? { ...item, error: message, status: 'error' } : item)));
            setLane(chat.draft.id, 100, true);
            throw chatError;
          }
        }),
      );

      setHeldOut(pairs.slice(0, 20));
      setSubjectMessages(subject.slice(0, 3_000));

      addLog('Engrams done. Merging into one report.');
      setLane('merge', 25);
      const merged = await api<Phase2Response>('/api/phase2', key, {
        chats: chats.map((chat, i) => ({
          chat: chat.label,
          relationship: chat.draft.relationship,
          subject: chat.draft.subject,
          engram: engrams[i],
          stats: statsByChat[i],
        })),
      });
      setReport(merged.markdown);
      setSketches(merged.report.sketches.map(sketch => `${sketch.situation} Drive: ${sketch.drive}`));
      setDrives(merged.report.drives.map(drive => drive.drive));
      setConfidence(merged.report.ledger.map(row => row.confidence));
      setLane('merge', 100);

      addLog('Report written. Drafting the questionnaire.');
      setLane('questions', 40);
      const asked = await api<Phase3aResponse>('/api/phase3a', key, { report: merged.markdown, n: chats.length });
      setLane('questions', 100);
      setQuestions(asked.questionnaire);
      setAnswers(Object.fromEntries(asked.questionnaire.items.map(item => [item.id, item.default])));
      setQIndex(0);
      setStage('questions');
      addLog(`${asked.questionnaire.items.length} questions ready.`);
    } catch (buildError) {
      const message = describeFailure(buildError, 'build failed');
      setError(message);
      addLog(`Build failed: ${message}`);
      setStage('chats');
    } finally {
      running.current = false;
    }
  }

  async function compose(
    finalAnswers: Record<string, string>,
    options: { previous?: string; fixes?: string[]; revise?: boolean } = {},
  ): Promise<ComposeResponse | null> {
    setError('');
    if (!options.revise) {
      setStage('soul');
      setLane('soul', 20);
    }
    try {
      const response = await api<ComposeResponse>('/api/compose', key, {
        // The parsed report outlives the Phase 2 response, so a large payload is safe to resend.
        report,
        answers: finalAnswers,
        n: drafts.length,
        previous: options.previous,
        fixes: options.fixes,
      });
      if (!options.revise) setLane('soul', 100);
      setResult(response);
      setStage('done');
      addLog(`Pack ready: ${response.files.length} files.`);
      packStore.set(Object.fromEntries(response.files.map(file => [file.path, file.source])));
      // The pack is built, so the raw transcripts are no longer needed.
      setDrafts(current => current.map(draft => ({ ...draft, messages: [] })));
      return response;
    } catch (composeError) {
      setError(describeFailure(composeError, 'compose failed'));
      if (!options.revise) {
        setStage('questions');
        setLane('soul', 0);
      }
      return null;
    }
  }

  function answer(value: string) {
    if (!questions) return;
    const item = questions.items[qIndex];
    const next = { ...answers, [item.id]: value };
    setAnswers(next);
    if (qIndex + 1 < questions.items.length) setQIndex(qIndex + 1);
    else void compose(next);
  }

  const download = useMemo(() => async () => {
    if (!result) return;
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const file of result.files) zip.file(file.path, file.source);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'soul-pack.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const estimate = useMemo(
    () =>
      drafts.length && stage === 'chats'
        ? estimateRun(drafts.map(draftMessages), mode)
        : null,
    [drafts, stage, mode],
  );
  const { models, defaults, choice } = modelState;
  const price = (id: string) => models.find(model => model.id === id);
  const cost = estimate
    ? estimateCost(estimate, price(choice.cheap || defaults.cheap), price(choice.strong || defaults.strong))
    : null;
  const needsKey = !key;
  const files = result?.files ?? [];
  const current = files[Math.min(fileIndex, Math.max(0, files.length - 1))];
  const busy = stage === 'running' || stage === 'soul';
  const statusText = busy ? 'building' : stage === 'done' ? 'complete' : stage === 'questions' ? 'asking' : error ? 'error' : 'idle';
  const statusClass = busy ? 'painting' : stage === 'done' ? 'complete' : '';
  const blocker = !drafts.length
    ? 'Add at least one chat export.'
    : !drafts.every(draft => draft.subject && draft.messages.length > 1)
      ? 'Each chat needs a subject and more than one message.'
      : !consent
        ? 'Confirm everyone agreed.'
        : needsKey
          ? 'Add your OpenRouter key.'
          : '';

  return (
    <main className={`wrap ${drawer ? 'drawer-open' : ''}`}>
      <header className="masthead">
        <div className="wordmark">
          <h1>Constructinator</h1>
        </div>
        <div className="row">
          <span className={`status ${statusClass}`}><i /> {statusText}</span>
          <button
            type="button"
            className={`iconbtn ${drawer ? 'active' : ''}`}
            onClick={() => setDrawer(value => !value)}
            aria-pressed={drawer}
            aria-controls="drawer"
            title={drawer ? 'Hide inspector' : 'Show inspector'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Inspect{log.length ? <span className="badge">{log.length}</span> : null}
          </button>
        </div>
      </header>

      <div className={`grid ${drawer ? 'with-drawer' : ''}`}>
        {/* ---------------- controls rail ---------------- */}
        <div className="stack rail">
          <KeyPanel value={key} onChange={setKey} open={panels.open.key} onToggle={panels.toggle} disabled={busy} />
          <ModelsPanel state={modelState} open={panels.open.models} onToggle={panels.toggle} disabled={busy} />

          {stage === 'chats' || stage === 'running' ? (
            <section className="panel">
              <div className="body">
                <label className="check" htmlFor="consent" style={{ marginTop: 0 }}>
                  <input id="consent" type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
                  <span>Everyone in these chats agreed</span>
                </label>
                <div className="divider" />
                <label className="check" htmlFor="mode-one-shot">
                  <input
                    id="mode-one-shot"
                    type="radio"
                    name="mode"
                    value="one-shot"
                    checked={mode === 'one-shot'}
                    disabled={busy}
                    onChange={() => setMode('one-shot')}
                  />
                  <span className="row" style={{ gap: 6 }}>
                    One-shot each chat
                    <span
                      className="chip"
                      style={{ height: 18, padding: '0 6px', font: '500 10px/1 var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}
                    >
                      Recommended
                    </span>
                  </span>
                </label>
                <label className="check" htmlFor="mode-chunked">
                  <input
                    id="mode-chunked"
                    type="radio"
                    name="mode"
                    value="chunked"
                    checked={mode === 'chunked'}
                    disabled={busy}
                    onChange={() => setMode('chunked')}
                  />
                  <span>Chunked</span>
                </label>
              </div>
            </section>
          ) : null}

          {estimate ? (
            <div className="estimate">
              <b>{cost === null ? '—' : `~${formatCost(cost)}`}</b>
              <span>
                {formatTokens(estimate.bulk.input + estimate.strong.input)} in · {formatTokens(estimate.bulk.output + estimate.strong.output)} out
              </span>
            </div>
          ) : null}

          <div className="actions">
            {stage === 'chats' || stage === 'running' ? (
              <button className="primary" disabled={!!blocker || stage === 'running'} onClick={() => void build()} title={blocker}>
                {stage === 'running' ? 'Building…' : 'Build engrams'}
              </button>
            ) : null}
            {stage !== 'chats' ? (
              <button className="ghost" onClick={reset} disabled={busy}>Start over</button>
            ) : null}
          </div>
        </div>

        {/* ---------------- stage ---------------- */}
        <div className="stack work">
          <section className="panel fill">
            <div className="head">
              <div className="row">
                <Stepper step={step} />
              </div>
              {stage === 'done' && result ? (
                <div className="row">
                  <button className="small" onClick={() => window.open('/try', '_blank')}>Try it</button>
                  <button className="small primary" onClick={() => void download()}>Download zip</button>
                </div>
              ) : null}
            </div>

            <div className="scroll">
              {stage === 'chats' || stage === 'running' ? (
                <>
                  {drafts.length < 6 && stage === 'chats' ? (
                    <div
                      className={`drop ${over ? 'over' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInput.current?.click()}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click();
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        setOver(true);
                      }}
                      onDragLeave={() => setOver(false)}
                      onDrop={event => {
                        event.preventDefault();
                        setOver(false);
                        void addFiles(event.dataTransfer.files);
                      }}
                    >
                      <b>Drop chat exports</b>
                      <span>{drafts.length} / 6</span>
                    </div>
                  ) : null}
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".txt,.csv,text/plain"
                    multiple
                    hidden
                    onChange={event => {
                      if (event.target.files) void addFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  {dropError ? <span className="err">{dropError}</span> : null}

                  {drafts.length ? (
                    <div className="cards">
                      {drafts.map((draft, index) => (
                        <ChatCard
                          key={draft.id}
                          draft={draft}
                          index={index}
                          locked={stage === 'running'}
                          onChange={next => setDrafts(list => list.map(item => (item.id === next.id ? next : item)))}
                          onRemove={() => setDrafts(list => list.filter(item => item.id !== draft.id))}
                        />
                      ))}
                    </div>
                  ) : null}

                  {lanes.length ? <Lanes lanes={lanes} /> : null}
                  {error ? <span className="err">{error}</span> : null}
                </>
              ) : null}

              {stage === 'questions' && questions ? (
                <>
                  <div className="row between">
                    <span className="count">Question {qIndex + 1} of {questions.items.length}</span>
                    {qIndex > 0 ? <button className="small ghost" onClick={() => setQIndex(qIndex - 1)}>Back</button> : null}
                  </div>
                  <div className="progress"><i style={{ width: `${(qIndex / questions.items.length) * 100}%` }} /></div>
                  <QuestionCard key={questions.items[qIndex].id} item={questions.items[qIndex]} onAnswer={answer} />
                  {error ? <span className="err">{error}</span> : null}
                </>
              ) : null}

              {stage === 'soul' ? (
                <>
                  <Lanes lanes={lanes.filter(lane => lane.id === 'soul')} />
                  {error ? <span className="err">{error}</span> : null}
                </>
              ) : null}

              {stage === 'done' && result ? (
                <>
                  <div className="summary">
                    <div className="stat"><b>{result.files.length}</b><span>files</span></div>
                    <div className="stat">
                      <b>{Math.round(result.files.reduce((sum, file) => sum + file.bytes, 0) / 1024)}<small> kb</small></b>
                      <span>pack size</span>
                    </div>
                    <div className="stat"><b>{drafts.length}</b><span>chats</span></div>
                    <div className="stat">
                      <b>{confidence.filter(value => value === 'high').length}<small> / {confidence.length}</small></b>
                      <span>high confidence</span>
                    </div>
                  </div>

                  {result.issues.length || result.poolIssues.length ? (
                    <div className="issues">
                      {result.issues.map((issue, i) => <span key={i}>{issue.slot}: {issue.detail}</span>)}
                      {result.poolIssues.map((issue, i) => <span key={i}>{issue.pool}: {issue.detail}</span>)}
                    </div>
                  ) : null}

                  <FidelityPanel
                    files={Object.fromEntries(result.files.map(file => [file.path, file.source]))}
                    drives={drives}
                    pairs={heldOut}
                    subjectMessages={subjectMessages}
                    sketches={sketches}
                    removedTraits={(questions?.items ?? [])
                      .filter(item => item.id.startsWith('trait-') && answers[item.id] === 'Remove')
                      .map(item => `${item.text} (${item.quote})`)}
                    onRevise={async fixes => {
                      const next = await compose(answers, { previous: result.markdown, fixes, revise: true });
                      return next ? Object.fromEntries(next.files.map(file => [file.path, file.source])) : null;
                    }}
                  />
                </>
              ) : null}
            </div>
          </section>
        </div>

        {/* ---------------- inspector drawer ---------------- */}
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <aside id="drawer" className={`drawer ${drawer ? 'open' : ''}`} aria-label="Inspector" aria-hidden={!drawer}>
          <section className="panel fill">
            <div className="head">
              <Seg
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'report', label: 'Report' },
                  { id: 'files', label: files.length ? `Files · ${files.length}` : 'Files' },
                  { id: 'log', label: log.length ? `Log · ${log.length}` : 'Log' },
                ]}
              />
              <div className="row">
                {tab === 'log' ? <button className="small ghost" onClick={() => setLog([])} disabled={!log.length}>Clear</button> : null}
                <button className="small ghost close" onClick={() => setDrawer(false)} aria-label="Hide inspector">✕</button>
              </div>
            </div>
            {tab === 'report' ? (
              <>
                <pre>{report || ' '}</pre>
              </>
            ) : null}
            {tab === 'files' ? (
              <>
                {files.length ? (
                  <div className="note">
                    <select value={fileIndex} onChange={event => setFileIndex(Number(event.target.value))}>
                      {files.map((file, index) => <option key={file.path} value={index}>{file.path}</option>)}
                    </select>
                  </div>
                ) : null}
                <pre>{current?.source ?? ' '}</pre>
              </>
            ) : null}
            {tab === 'log' ? (
              <div className="log">{log.length ? log.map((line, i) => <div key={i}>{line}</div>) : <div> </div>}</div>
            ) : null}
          </section>
        </aside>
      </div>
    </main>
  );
}

const STEP_LABELS = ['Chats', 'Engrams', 'Questions', 'Soul', 'Pack'];

function Lanes({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="lanes">
      {lanes.map(lane => (
        <div key={lane.id} className="laneRow">
          <span className="name">{lane.label}</span>
          <div className={`progress ${lane.bad ? 'bad' : lane.value >= 100 ? 'fin' : 'live'}`}>
            <i style={{ width: `${lane.value}%` }} />
          </div>
          <span className="pct">{lane.value}%</span>
        </div>
      ))}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <span className="steps" aria-label={`Step ${step + 1} of 5`}>
      {STEP_LABELS.map((label, index) => (
        <span key={label} className={`step ${index < step ? 'done' : index === step ? 'now' : ''}`}>
          <i />
          {label}
        </span>
      ))}
    </span>
  );
}

/** A failed call as the user should see it: the message, plus the id that matches the server log. */
function describeFailure(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const id = (error as ApiError).requestId;
  return id ? `${error.message} (id ${id})` : error.message;
}
