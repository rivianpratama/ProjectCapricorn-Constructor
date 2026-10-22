'use client';

import { useMemo, useRef, useState } from 'react';
import { analyse, chunkMessages, heldOutPairs, pseudonymise, splitHoldout } from '../lib/chats/analyse';
import type { ChatStats, HeldOutPair } from '../lib/chats/types';
import { api, keyStore, packStore } from '../lib/client/api';
import { draftFromFile, draftMessages, type Draft } from '../lib/client/drafts';
import type { Questionnaire } from '../lib/schema/questionnaire';
import type { PackFile } from '../lib/soul/pack';
import { ChatCard } from './ChatCard';
import { FidelityPanel } from './FidelityPanel';
import { QuestionCard } from './QuestionCard';

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
  const [key, setKey] = useState(() => keyStore.get());

  const [keyBad, setKeyBad] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(() => keyStore.remembered());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dropError, setDropError] = useState('');
  const [consent, setConsent] = useState(false);
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

  async function checkKey() {
    if (key.trim().length < 20) return;
    try {
      await api('/api/key', key, {});
      setKeyBad(false);
      keyStore.set(key, remember);
    } catch {
      setKeyBad(true);
    }
  }

  async function build() {
    if (running.current || !ready) return;
    running.current = true;
    setError('');
    setStage('running');
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
            const chunks = chunkMessages(pseudoTraining, 1200, 60);
            let finished = 0;

            const parts = await Promise.all(
              chunks.map(async (chunk, ci) => {
                const response = await api<Phase1Response>('/api/phase1', key, {
                  chat: chat.label,
                  relationship: chat.draft.relationship,
                  subject: chat.draft.subject,
                  messages: chunk,
                  stats: analyse(chunk, chat.draft.subject),
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

      setLane('questions', 40);
      const asked = await api<Phase3aResponse>('/api/phase3a', key, { report: merged.markdown, n: chats.length });
      setLane('questions', 100);
      setQuestions(asked.questionnaire);
      setAnswers(Object.fromEntries(asked.questionnaire.items.map(item => [item.id, item.default])));
      setQIndex(0);
      setStage('questions');
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : 'build failed');
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
        report,
        answers: finalAnswers,
        n: drafts.length,
        previous: options.previous,
        fixes: options.fixes,
      });
      if (!options.revise) setLane('soul', 100);
      setResult(response);
      setStage('done');
      packStore.set(Object.fromEntries(response.files.map(file => [file.path, file.source])));
      // The pack is built, so the raw transcripts are no longer needed.
      setDrafts(current => current.map(draft => ({ ...draft, messages: [] })));
      return response;
    } catch (composeError) {
      setError(composeError instanceof Error ? composeError.message : 'compose failed');
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

  return (
    <main>
      <Stepper step={step} />
      <h1>Constructinator</h1>

      {stage === 'chats' || stage === 'running' ? (
        <div className="stack">
          <div className="row">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              placeholder="sk-or-…"
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1 }}
              onChange={event => {
                setKey(event.target.value);
                setKeyBad(false);
                keyStore.set(event.target.value, remember);
              }}
              onBlur={checkKey}
            />
            <button onClick={() => setShowKey(value => !value)}>{showKey ? 'hide' : 'show'}</button>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={event => {
                  setRemember(event.target.checked);
                  keyStore.set(key, event.target.checked);
                }}
              />
              <span className="muted">remember</span>
            </label>
          </div>
          {keyBad ? <span className="bad">key rejected</span> : null}

          {drafts.length < 6 ? (
            <div
              className="drop"
              onClick={() => fileInput.current?.click()}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                void addFiles(event.dataTransfer.files);
              }}
            >
              drop chat exports
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
          {dropError ? <span className="bad">{dropError}</span> : null}

          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
            <span className="muted">everyone in these chats agreed to this</span>
          </label>

          {drafts.map((draft, index) => (
            <ChatCard
              key={draft.id}
              draft={draft}
              index={index}
              onChange={next => setDrafts(current => current.map(item => (item.id === next.id ? next : item)))}
              onRemove={() => setDrafts(current => current.filter(item => item.id !== draft.id))}
            />
          ))}

          {lanes.length ? (
            <div className="lanes">
              {lanes.map(lane => (
                <div key={lane.id} className="row" style={{ gap: 10 }}>
                  <span className="muted" style={{ width: 90 }}>{lane.label}</span>
                  <div className="lane" style={{ flex: 1 }}>
                    <i style={{ width: `${lane.value}%`, background: lane.bad ? 'var(--bad)' : undefined }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <span className="bad">{error}</span> : null}

          <div className="row">
            <button className="primary" disabled={!ready || !key || stage === 'running'} onClick={() => void build()}>
              Build engrams
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'questions' && questions ? (
        <div className="stack">
          <div className="muted">{qIndex + 1} / {questions.items.length}</div>
          <QuestionCard item={questions.items[qIndex]} onAnswer={answer} />
          {error ? <span className="bad">{error}</span> : null}
        </div>
      ) : null}

      {stage === 'soul' ? (
        <div className="lanes">
          <div className="row" style={{ gap: 10 }}>
            <span className="muted" style={{ width: 90 }}>soul</span>
            <div className="lane" style={{ flex: 1 }}>
              <i style={{ width: `${lanes.find(lane => lane.id === 'soul')?.value ?? 20}%` }} />
            </div>
          </div>
          {error ? <span className="bad">{error}</span> : null}
        </div>
      ) : null}

      {stage === 'done' && result ? (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="stack" style={{ gap: 2 }}>
              <b>{result.files.length} files</b>
              <span className="muted">
                {Math.round(result.files.reduce((sum, file) => sum + file.bytes, 0) / 1024)} kb · {drafts.length} chats ·{' '}
                {confidence.filter(value => value === 'high').length} high / {confidence.filter(value => value === 'medium').length} medium /{' '}
                {confidence.filter(value => value === 'low').length} low
              </span>
            </div>
            <div className="row">
              <button onClick={() => window.open('/try', '_blank')}>Try</button>
              <button className="primary" onClick={() => void download()}>Download</button>
            </div>
          </div>

          {result.issues.length || result.poolIssues.length ? (
            <div className="card stack">
              {result.issues.map((issue, i) => (
                <span key={i} className="bad">{issue.slot}: {issue.detail}</span>
              ))}
              {result.poolIssues.map((issue, i) => (
                <span key={i} className="bad">{issue.pool}: {issue.detail}</span>
              ))}
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

          <div className="row">
            <button onClick={reset}>Start over</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="row" style={{ gap: 6, marginBottom: 28 }}>
      {[0, 1, 2, 3, 4].map(index => (
        <i
          key={index}
          style={{
            height: 3,
            flex: 1,
            borderRadius: 2,
            background: index <= step ? 'var(--ink)' : 'var(--dead)',
          }}
        />
      ))}
    </div>
  );
}
