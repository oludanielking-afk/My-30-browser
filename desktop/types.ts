export type Profile = {
  id: string;
  name: string;
  url: string;
  autoReload: boolean;
  minSeconds: number;
  maxSeconds: number;
};
export type ProfileView = Profile & {
  state: string;
  browserOpen?: boolean;
  nextReload?: number;
  lastReload?: number;
  note?: string;
  error?: string;
};
export type Snapshot = {
  profiles: ProfileView[];
  running: number;
  maxActive: number;
  memoryFreeMB: number;
};
export type Action = "start" | "stop" | "reload" | "pause" | "resume";
export interface API {
  snapshot(): Promise<Snapshot>;
  update(id: string, patch: Partial<Profile>): Promise<void>;
  action(id: string, action: Action): Promise<void>;
  limit(n: number): Promise<void>;
  worker(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}
