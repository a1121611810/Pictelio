# Cross-stream contamination in app-lynx novel translation — verdict

**Question**: does a reachable interleaving exist in which two translation streams are alive at once and contaminate each other (one stream's frames consumed by another translation, or an old OkHttp stream not actually cancelled → paragraph mixing)?

**Verdict: REACHABLE — yes.** Two native streams *can* be live simultaneously, and three shared mutable fields on the (per-view singleton) `PictelioTranslateModule` then cross-contaminate. The safety premise tested ("`concurrency: 1` + chapters are serial") only serializes *chunk sub-requests inside one pipeline run*; it has no reach into the native side and no reach across pipeline runs. On top of that, the JS→Java cancellation path is **structurally dead**: `abortStream` is not reachable while a stream is live, so an abandoned OkHttp `Call` keeps streaming for the rest of the LLM response (bounded only by the 45 s idle `readTimeout`). See §2 for why this is not a race but a missing edge, and §3-§4 for the mechanisms and the concrete interleavings.

Two accuracy caveats up front:
- **Revision**: all `PictelioTranslateModule.java` line numbers are from **HEAD `108d892d8b7329cb42de1aa9d582d290aa7a02f7`** (verified via `git show HEAD:<path>`). The working tree copy of that file was **being edited by another process during this investigation** (md5 changed twice: `fc587e1a…` 958 lines → `732d85ba…` 962 lines; diff vs HEAD = dead-code deletion of `drainOrFinish`/`framesDispatched`/`mainHandler`/`isDoneTerminal` + comment edits). I diffed the delta against every line I rely on: **no change to `frameQueue`, `sseParser`, `deltaSeen`, `ACTIVE_CALLS`, `USER_ABORTED`, `abortStream`, `translateStream`, `translatePoll`**. WT line numbers where they differ are given inline. Nothing in the repo was modified by me.
- **[read]** = I read the line; **[inferred]** = deduction from those lines.

---

## 1. What `concurrency: 1` actually guards (and who guarantees "chapters are serial")

`packages/app-lynx/src/stores/novelTranslateStore.ts:785` — `concurrency: provider.id === "native-bridge" ? 1 : undefined` (HEAD/clean file, stable line number).

Scope chain [read]:
- `createNovelTranslator` stores it as `const concurrency = options.concurrency ?? 3` (`packages/app-lynx/src/primitives/createNovelTranslator.ts:431`) and passes it to `runChunkPool(chunks, fetch, concurrency, signal, maxRetries)` (`:481`).
- `runChunkPool` spawns `Math.min(concurrency, chunks.length)` workers (`createNovelTranslator.ts:206-207`), each pulling the next chunk from a shared cursor (`:209-235`).

So the guard is exactly: **one `provider.translate()` iterator in flight at a time, within a single `translator.translate()` invocation**. It is built fresh per run (`novelTranslateStore.ts:779-786`), so it does **not** constrain a second pipeline run — and it has no counterpart on the Java side at all.

"Chapters are serial" is **not guaranteed by anything**:
- app-lynx has no chapter dimension: the page comment states the translation `chapterId` *is* the current `novelId` (`packages/app-lynx/src/pages/NovelDetail.vue:175`).
- Cross-run exclusion rests solely on the store's same-chapter in-flight reuse guard, which requires `status ∈ {translating, pending}` (`novelTranslateStore.ts:615-621`). A *different* `novelId`, or the *same* one after an abort (`abort()` synchronously writes `status = "aborted"`, `:993-999`), misses the guard and starts a new run immediately.
- Each run creates a **fresh provider instance** (`nativeTranslateProvider()` at `:909`), which generates a **fresh `streamId`** (`packages/app-lynx/src/api/nativeTranslate.ts:589`) and calls `translateStream` fire-and-forget (`:590-602`).
- The JS generation gate (`gen`, `:680/:829/:838/:856`) only discards stale *results on the JS side*; it stops nothing natively.
- Nothing waits for a native stream to be stopped before the next one starts: the store aborts its own `AbortController` (`:678`) and returns; page teardown does `abort()` + `reset()` and returns (`NovelDetail.vue:330-331`).

## 2. The crux: an abandoned stream is never cancelled (structural, not racy)

Java-side cancellation exists and would work: `abortStream` marks `USER_ABORTED` then `call.cancel()` on the entry removed from `ACTIVE_CALLS` (`PictelioTranslateModule.java:759-772`; registry at `:104`, aborted-set at `:115`). [read] The problem is the JS never calls it for a live stream. The citation chain:

1. The only production caller of `abortStream` is `abortHandle?.abort()` inside `nativeTranslateProvider` (`nativeTranslate.ts:474`, and the provider's own `abort()` at `:655`); the module wrapper is at `:413-430`. No other module imports it (repo-wide grep; only `rspeedy-env.d.ts:162` declares the type). [read]
2. `abortHandle` is assigned in exactly one place: `.then((h) => { abortHandle = h; … })` (`nativeTranslate.ts:603-606`). The promise settles only if the native `translateStream` **callback** delivers a `{"type":"done"}` chunk (`:216-228`). [read]
3. On the Java side, the `translateStream` callback is invoked in the stream path in exactly **two** places: request-construction failure (`:357`) and the SSE terminal-error sink (`:914`, `callback.invoke("", error)`). Both are `("", errMsg)` → the JS wrapper **rejects**. Success (`response.completed`) goes `emitConsolidated` + `done` into the **frame queue** via the sink lambda (`:899-921`), never to the callback. The only code that ever pushed dead frames to the callback was `drainOrFinish` (`:644-676`), which **has no caller in HEAD** (grep of `git show HEAD:…` shows it only at its declaration `:644` and its self-recursion `:655`) — and it is precisely what the concurrent working-tree edit deletes as dead code. [read for the lines; inferred for "no caller", corroborated by the dead-code deletion]

Consequence [inferred, from 1-3]: `abortHandle` is **never** assigned, so `void abortHandle?.abort()` is a no-op; `abortStream` is never invoked for a live stream; `USER_ABORTED` never receives an entry. A stream that the user abandons (stop button, page unmount, navigate to another novel) keeps its `Call` in `ACTIVE_CALLS` and keeps reading SSE until the server closes or 45 s of silence elapse (`STREAM_CLIENT` at `:173-180`, `callTimeout(0)`). The JS only stops *listening* (`detachOnce`, `:458-462`, `:473`, `:565-567`); the JS-side `abort` (`novelTranslateStore.ts:993-999`) is a purely local unwinding of the JS pipeline.

This also answers ticket question 3 directly: **`abortStream`/`ACTIVE_CALLS` themselves are sound — `Call.cancel()` on a live OkHttp call does cancel it — but they are unreachable for a live stream.** The gap is upstream (missing edge), not a flaky race.

## 3. The contamination mechanisms (shared instance state)

Module identity [read/interop]: `LynxActivity.java:222/231/234` builds **one** `LynxViewBuilder`, registers `PictelioTranslate` in *class* form, and calls `builder.build(this)` once. In Lynx 4.0.1 the registered form is cached: `com.lynx.jsbridge.CommonModuleCreator` holds `ConcurrentHashMap<String, LynxModuleWrapper> mModulesByName`, and `LynxModuleWrapper` holds the single `LynxModule mModule` (verified with `javap` against `~/.gradle/caches/…/lynx-4.0.1-runtime.jar`). Hence per app session there is **one** module object, and these instance fields are effectively global (the class comment says as much at `:395-396`).

- `frameQueue` — `private final ConcurrentLinkedQueue<String>` (`:146-147`), one buffer for all streams.
- `sseParser` — `private TranslationSseParser sseParser` (`:119`), re-created at each stream start (`:397`) — but that *re-creation* is what reintroduces sharing: the field is overwritten by the *later* stream, and every per-line parse reads the field (`:901-902`).
- `deltaSeen` (`:121`), `deltaCount` (`:123`) — same reset-then-share pattern (`:391-392`).

**M2 — parser content mixing (primary; wide window).** Stream A is abandoned-but-alive (per §2). Stream B starts: B's worker sets `sseParser = new TranslationSseParser()` (`:397`; WT `:399`) and clears the buffer (`:394`; WT `:396`). A's reader thread then calls `processSseLine` for each of A's remaining SSE lines, reading the *field* (`:901`) → A's `response.output_text.delta` lines are accumulated into **B's parser instance** (`TranslationSseParser.java:134-137`, `paragraphText` a `TreeMap`, `anchorIndex`/`anchorCarry` shared state at `:27-28`). When B receives `response.completed`, the shared instance emits one consolidated frame containing **A's text + B's text** (`TranslationSseParser.java:146-159` → `emitConsolidated` `:74-94`), which B's worker drains and stamps as B's (`:409-417` + `withStreamId` `:529-534`) → JS accepts it (streamId matches) → `nativeTranslate.ts:503-508` expands `delta_all` → `novelTranslateStore.ts:810-815` appends `chunk.text` at `offset + paragraphIndex`. Window = the entire remaining lifetime of A's response (seconds to minutes), not microseconds. [read for the mechanics; inferred for the timing, which follows from §2]

**M1 — drain attribution race (secondary; narrow).** Every worker drains the *whole* shared queue into its own stream's map: `buffer = new ConcurrentLinkedQueue<>(frameQueue)` then `STREAM_FRAMES[streamId].offer(withSeq(withStreamId(...)))` (`:409-417`). The streamId stamped on a frame is the id of the **worker that drained it**, not of the stream that produced it. If A's end-of-parse and B's drain overlap (both streams ending within the same few-ms window), the queue splits at a nondeterministic boundary and A's consolidated text is delivered **as B's frames** — exactly "one stream's frames consumed by another translation". The mirror direction (A's drain stealing B's frames) stamps B's paragraphs with streamId=A; A's listener is detached, so that text is dropped, and because `emitConsolidated`/`flushIfAny` clear the accumulator (`TranslationSseParser.java:50-51`) it is lost for good → B's paragraphs silently fall back to the original Japanese (`alignParagraphs` fallback, `createNovelTranslator.ts:104-118`). [read for the code paths; inferred for the race window]

**M3 — shared parse state / cross-wired termination.** `readTimeout`-bounded but real: `deltaSeen=false` at B's start (`:391`; WT `:394`) can make A be judged "no translation produced" (`:424-428`) even though A produced frames; A's end-of-stream reads `sseParser.terminalError()` (`:418`) — i.e. **B's** parser state — so B's failure can be reported as A's terminal and vice versa; A's `flushIfAny` (`:401-405`) drains *B's* accumulator into A's buffer. Additionally, two reader threads calling `accept` on one non-thread-safe instance mutate a shared `TreeMap` concurrently (`TranslationSseParser.java:36`, `:134-137`) while `emitConsolidated` iterates it (`:80`), which can throw `ConcurrentModificationException` (swallowed → empty frame → JS "no chunks emitted", `createNovelTranslator.ts:336-339`) or lose entries. `deltaSeen`/`sseParser` are plain (non-`volatile`) fields — the JMM does not guarantee prompt visibility of the swap, which is the one uncertainty in M2/M3 (it does not affect M1, which relies only on `ConcurrentLinkedQueue`). [read; the visibility nuance is [inferred] from the field declarations]

## 4. Reachable interleavings (no device needed to see the code path)

**I1 — stop → start, same novel (pure taps, ~2 s):**
1. t0 user taps 翻译 → `translateChapter(novelId, chapterId=novelId, …)` (`novelTranslateStore.ts:589`) → stream `S1` `translateStream` (Java `ACTIVE_CALLS.put("S1", call1)` `:364`), Java worker W1 parsing.
2. t1 user taps again → `buttonState === "translating"` → `store.abort()` (`TranslateButton.vue:97-101`) → `activeController?.abort()` (`:994`) → provider `onAbort` (`nativeTranslate.ts:469-477`) → `abortHandle?.abort()` = **no-op (§2)** → W1 and `call1` stay live. JS sets `status = "aborted"` (`:996-998`).
3. t2 user taps again → `buttonState === "start"` → `translateChapter` same chapterId; the reuse guard fails because status is no longer translating/pending (`:615-621`) → **new run → new streamId `S2`** (`nativeTranslate.ts:589`) → Java `frameQueue.clear()` (`:394`), `deltaSeen=false` (`:391`), `sseParser = new` (`:397`) [HEAD numbers].
4. W1 is still parsing → **M2** injects the rest of S1's text into S2's parser → S2's `done` frame carries S1's paragraphs → JS writes them into `translatedParagraphs` for S2 (`:810-815`) → on completion that mixed array is written to the translation cache (`:855`), poisoning the cached translation. **Two live OkHttp streams, one shared queue/parser — exactly the contamination in the question.**

**I2 — navigate away, translate another novel:** `onUnmounted` → `abort()` + `reset()` (`NovelDetail.vue:330-331`) → same no-op abort; a later `translateChapter(novelIdB, …)` is a different chapterId → new stream while S1 is alive → M2/M1.

**I3 — within one run, no user action:** the JS poll gives up after `POLL_MAX = 600` × 250 ms (`nativeTranslate.ts:483-484`, `:548-559`) while a server that keeps dribbling non-terminal SSE lines keeps the Java stream alive (each line resets the 45 s read timeout). Concurrency 1 then advances to the next chunk → second live stream. [inferred]

## 5. Premise list (safety premises; a change that *breaks* one is detectable — status as of HEAD)

| # | Premise that safety would rest on | Code location | Status |
|---|---|---|---|
| P1 | At most one live native stream at a time | no guard in `translateStream` (`:292-453`); store guard `novelTranslateStore.ts:615-621` is per-chapterId | **BROKEN** |
| P2 | JS abort cancels the native OkHttp call | `nativeTranslate.ts:474` + `:604` (handle never assigned); `abortStream` `:759-772` unreachable for live streams | **BROKEN** |
| P3 | Per-stream parse state is not shared | `sseParser` `:119` re-created `:397` then overwritten by the next stream; `deltaSeen` `:121`/`:391`; `frameQueue` `:146-147` | **BROKEN** |
| P4 | A frame is stamped with the streamId that produced its content | stamping happens at drain time with the draining worker's id (`:414-416`, `:529-534`) | **BROKEN** |
| P5 | JS streamId filtering stops cross-stream frames | filter exists `nativeTranslate.ts:328-334` (event bus) | holds for *foreign-id* frames only; useless against P4 mis-stamping |
| P6 | `frameQueue.clear()` on start gives the new stream a clean buffer | `:394` (WT `:396`) | **insufficient**: it discards the old stream's frames and does not stop the old stream from writing more |
| P7 | Provider `concurrency: 1` serializes native calls | `novelTranslateStore.ts:785` → `createNovelTranslator.ts:206-207` | holds **within one run only** |
| P8 | Chapter/novel switch stops the old stream before a new one starts | no such code; `abort()` is fire-and-forget (`:678`, `NovelDetail.vue:330`) | **BROKEN** |
| P9 | The module instance (and its fields) is shared across streams | `LynxActivity.java:222/231/234` + Lynx registered-form cache (`CommonModuleCreator.mModulesByName`) | holds — and this is what makes P3 consequential |

Minimum repair shape (not part of this ticket): push `frameQueue`/`sseParser`/`deltaSeen`/`deltaCount` into a per-stream object keyed by `streamId` (they are already keyed that way for `STREAM_FRAMES`/`STREAM_TERMINAL`/`STREAM_SEQ`), and make cancellation reachable (either settle the `translateStream` callback on terminal so `abortHandle` exists, or have the JS call `abortStream(streamId)` directly from the signal handler with the id it already knows).

## 6. What I could not verify

1. **Whether the `sseParser` swap is *observed* by the abandoned thread** (JMM: plain, non-`volatile` field). M1 does not depend on this; M2/M3 do. Practical ART behaviour makes visibility near-certain, but I could not prove it statically.
2. **Runtime confirmation that two OkHttp calls overlap in practice**, and which of M1/M2 dominates. This needs an emulator/device run (or a Robolectric test): Java already permits a loopback LLM baseURL precisely for this (`PictelioTranslateModule.java:319-327`), and the module is test-callable (`@LynxMethod public`, class-level Robolectric tests already exist, e.g. `packages/app/android/app/src/test/java/io/pictelio/app/TranslateEventContractTest.java`).
   **Deciding experiment**: Robolectric (or emulator + mock SSE at `http://10.0.2.2`) — call `translateStream` twice with distinct `_abortToken`s against two mock streams: A slow (emits `data: {"type":"response.output_text.delta","delta":"[0] AAA"}` then holds), B fast (emits B's deltas then `response.completed`). Then assert (a) `STREAM_FRAMES[B]`'s consolidated frame contains "AAA" (→ M2 confirmed), (b) with A's `response.completed` released just before B's end-of-parse, at least one `STREAM_FRAMES[B]` frame carries A's text (→ M1 confirmed), (c) logcat shows two overlapping `translateStream HTTP 200 开始读流` lines (`:385-386`). A cheap pure-Java variant: make the two `parseSseStream` producers and the two drain blocks deterministic with a latch and assert the same.
3. **Nothing was tested or built**: this was a read-only investigation (no `pnpm check`, no unit/E2E run), so the verdict is a source-level reachability argument, not an observed failure.
4. **Whether the concurrent working-tree edit** of `PictelioTranslateModule.java` (dead-code deletion, ongoing during this session) changes any of the above: as of md5 `732d85ba…` (962 lines) it does not — verified by diffing the changed lines against my citation set. If that file later changes `frameQueue`/`sseParser`/`abortStream`, the line numbers and P1-P4 statuses must be re-checked.
