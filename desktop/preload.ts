import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("manager", {
  snapshot: () => ipcRenderer.invoke("snapshot"),
  update: (id: string, p: unknown) => ipcRenderer.invoke("update", id, p),
  action: (id: string, a: string) => ipcRenderer.invoke("action", id, a),
  limit: (n: number) => ipcRenderer.invoke("limit", n),
  worker: (u: string, t: string) => ipcRenderer.invoke("worker", u, t),
  disconnect: () => ipcRenderer.invoke("disconnect"),
});
