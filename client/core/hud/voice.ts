// The microphone's state and who is heard, under the readout. The voice port is told where each speaker is by its own
// part of the frame (voice/heard.ts).

import { K_PANEL, lineHeight } from "../ui/nodes.ts";
import { S_BUFF } from "../ui/style.ts";
import { HEARD_MOST } from "../voice/heard.ts";
import { band, type HudWidget } from "./widget.ts";

/** Indexed by MODE_*. */
const TALK_LABEL: readonly string[] = ["WHISPERING", "TALKING", "YELLING"];

/** The voice status line under the readout. KEY_TALKER is one name per survivor being heard. */
export const KEY_VOICE = 37;
export const KEY_TALKER = 70;

export interface VoiceModel {
  /** The microphone's state, or why it is off. "" for nothing. */
  voice: string;
  talkers: string[];
  /** 0 to 1, for the settings screen. */
  micLevel: number;
}

export const VOICE: HudWidget<VoiceModel> = {
  name: "voice",
  bands: [band(KEY_VOICE, 1), band(KEY_TALKER, 8)],
  make: () => ({ voice: "", talkers: [], micLevel: 0 }),
  fill(m, c) {
    const f = c.frame;
    if (!f) return;
    m.talkers.length = 0;
    m.voice = "";
    const v = f.voice;
    if (!v) return;
    if (v.notice !== "") m.voice = v.notice;
    else if (f.talking) m.voice = f.settings.toggleTalk && !v.sending ? "MIC OPEN" : TALK_LABEL[f.talkMode]!;
    m.micLevel = v.level;
    let n = 0;
    for (const s of v.speakers.values()) {
      if (n++ >= HEARD_MOST) break;
      if (s.speaking && m.talkers.length < 8) m.talkers.push(s.name);
    }
  },
  build(f, m, at) {
    const { left, right, voiceY } = at;
    if (m.voice !== "") {
      // A voice state is in capitals and is lit. Anything else is a sentence saying what is wrong, drawn plain.
      const live = m.voice === m.voice.toUpperCase();
      const n = f.add(KEY_VOICE, K_PANEL, left, voiceY, Math.min(right - left, live ? 96 : 330), lineHeight(S_BUFF) + 4, S_BUFF);
      n.tint = !live ? 0x4a4f58 : m.voice === "MIC OPEN" ? 0x6a7a3a : 0x3c9a4a;
      n.text = m.voice;
    }
    const talkH = lineHeight(S_BUFF) + 4;
    for (let i = 0; i < m.talkers.length && i < 8; i++) {
      const n = f.add(KEY_TALKER + i, K_PANEL, left, voiceY + (talkH + 2) * (i + (m.voice !== "" ? 1 : 0)), 170, talkH, S_BUFF);
      n.tint = 0x2f5f8a;
      n.text = m.talkers[i]!;
    }
  },
};
