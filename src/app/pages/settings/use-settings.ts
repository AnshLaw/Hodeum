import { useMemo, useState } from "react";
import type { Settings } from "../../../data/settings";
import { useLiveQuery } from "../../hooks";
import type { AppServices } from "../../services";
import { SaveQueue } from "./save-queue";

export interface EditableSettings {
  settings?: Settings;
  loadError?: string;
  saveError?: string;
  update(next: Settings): void;
}

/** The page's own copy of the settings, updated instantly and saved in order behind the scenes. */
export function useEditableSettings(services: AppServices): EditableSettings {
  const [loaded] = useLiveQuery(services.bus, () => services.settings.load(), []);
  const [local, setLocal] = useState<Settings>();
  const [saveError, setSaveError] = useState<string>();
  const queue = useMemo(
    () =>
      new SaveQueue(
        services.settings,
        () => {
          setSaveError(undefined);
          services.bus.emit("settings:changed", {});
        },
        (error) => {
          console.error("Couldn't save settings", error);
          setSaveError(error instanceof Error ? error.message : String(error));
        },
      ),
    [services],
  );
  const settings = local ?? (loaded.state === "ready" ? loaded.value : undefined);
  const update = (next: Settings) => {
    setLocal(next);
    void queue.save(next);
  };
  return { settings, loadError: loaded.state === "error" ? loaded.message : undefined, saveError, update };
}
