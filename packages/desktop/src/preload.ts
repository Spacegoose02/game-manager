import { contextBridge, ipcRenderer } from "electron";

// The web UI checks for window.gameManager to switch from "copy this command"
// to real install, play and uninstall buttons.
contextBridge.exposeInMainWorld("gameManager", {
  version: 1,
  info: () => ipcRenderer.invoke("gm:info"),
  drives: () => ipcRenderer.invoke("gm:drives"),
  chooseFolder: () => ipcRenderer.invoke("gm:chooseFolder"),
  setInstallDir: (dir: string) => ipcRenderer.invoke("gm:setInstallDir", dir),
  installed: () => ipcRenderer.invoke("gm:installed"),
  install: (gameId: string, dir?: string) => ipcRenderer.invoke("gm:install", gameId, dir),
  cancel: (gameId: string) => ipcRenderer.invoke("gm:cancel", gameId),
  play: (gameId: string) => ipcRenderer.invoke("gm:play", gameId),
  uninstall: (gameId: string) => ipcRenderer.invoke("gm:uninstall", gameId),
  backupSaves: (gameId: string) => ipcRenderer.invoke("gm:backupSaves", gameId),
  restoreSaves: (gameId: string, saveId: number) => ipcRenderer.invoke("gm:restoreSaves", gameId, saveId),
  prepare: (gameId: string) => ipcRenderer.invoke("gm:prepare", gameId),
  uploadFolder: (gameId: string) => ipcRenderer.invoke("gm:uploadFolder", gameId),
  openFolder: (gameId: string) => ipcRenderer.invoke("gm:openFolder", gameId),
  changeServer: () => ipcRenderer.invoke("gm:changeServer"),
  toggleFullscreen: () => ipcRenderer.invoke("gm:toggleFullscreen"),
  onProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on("gm:progress", listener);
    return () => ipcRenderer.removeListener("gm:progress", listener);
  },
});

// The local setup page only needs to save the server address.
contextBridge.exposeInMainWorld("gameManagerSetup", {
  connect: (url: string) => ipcRenderer.invoke("gm:setServer", url),
});
