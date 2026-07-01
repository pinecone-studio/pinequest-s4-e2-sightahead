export type Voice = {
  id: string
  name: string
  gender: "male" | "female"
}

export const VOICES: Voice[] = [
  { id: "mn-MN-BataaNeural",  name: "Батаа", gender: "male"   },
  { id: "mn-MN-YesuiNeural",  name: "Есүй",  gender: "female" },
]

export const DEFAULT_VOICE_ID = VOICES[0]!.id
