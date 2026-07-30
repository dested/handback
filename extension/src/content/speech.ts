/**
 * Web Speech dictation — the panel's recorder runs this for the whole length of
 * a walkthrough. Chrome stops recognition on silence even in continuous mode, so
 * we transparently restart it — that's what makes "just keep talking" work
 * instead of dying after the first sentence.
 *
 * These lines are the live ticker only. The on-device Whisper pass replaces them
 * wholesale after stop, and Whisper's transcript is the one that ships.
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechEvent extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const speechSupported = Boolean(Ctor);

export type DictationState = 'off' | 'listening' | 'denied' | 'error';

export interface DictationHandlers {
  onFinal(text: string): void;
  onInterim(text: string): void;
  onState(state: DictationState, detail?: string): void;
}

export class Dictation {
  private recognition: Recognition | null = null;
  private wanted = false;
  private restartTimer: number | null = null;

  constructor(
    private handlers: DictationHandlers,
    private lang: string,
  ) {}

  get listening() {
    return this.wanted;
  }

  start() {
    if (!Ctor) {
      this.handlers.onState('error', 'This browser has no speech recognition.');
      return;
    }
    this.wanted = true;
    this.spin();
  }

  stop() {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.handlers.onInterim('');
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
    this.recognition = null;
    this.handlers.onState('off');
  }

  toggle() {
    if (this.wanted) this.stop();
    else this.start();
  }

  private spin() {
    if (!Ctor || !this.wanted) return;
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = this.lang || navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => this.handlers.onState('listening');

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) this.handlers.onFinal(text.trim());
        else interim += text;
      }
      this.handlers.onInterim(interim.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wanted = false;
        this.handlers.onState('denied', 'Microphone blocked on this site — type instead.');
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        /* normal; onend will restart */
      } else {
        this.handlers.onState('error', event.error);
      }
    };

    recognition.onend = () => {
      if (!this.wanted) return;
      // Chrome ends the stream after a silence; pick it straight back up.
      this.restartTimer = window.setTimeout(() => this.spin(), 120);
    };

    try {
      recognition.start();
    } catch {
      /* start() throws if a previous instance hasn't fully released */
    }
  }
}
