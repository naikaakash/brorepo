import { useEffect, useRef, useState } from "react";
import type { z } from "@applymate/contracts";
import { api, cancelled } from "./api";
import { Notice } from "./ui";

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(work: () => Promise<void>, message = ""): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); if (mounted.current) setNotice(message); return true; }
    catch (failure) {
      if (mounted.current && !cancelled(failure)) setError(failure instanceof Error ? failure.message : "The action failed. Refresh before retrying.");
      return false;
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { busy, run, feedback: <>{error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}</> };
}
export function useResource<T>(path: string, schema: z.ZodType<T>, pollWhile?: (data: T) => boolean) {
  const [result, setResult] = useState<{ path: string; data: T | null; error: string }>({ path: "", data: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api.request(path, schema, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult({ path, data, error: "" });
        if (pollWhile?.(data)) timer = setTimeout(() => { void load(); }, 1000);
      } catch (error) {
        if (!cancelled(error) && !controller.signal.aborted) setResult((previous) => ({
          path, data: previous.path === path ? previous.data : null, error: error instanceof Error ? error.message : "Could not load this item."
        }));
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, schema, pollWhile, revision]);
  return { data: result.path === path ? result.data : null, error: result.path === path ? result.error : "", reload: () => setRevision((value) => value + 1) };
}
export const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const phrases = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
export function downloadPackage(id: string, kind: "resume" | "cover", format: "pdf" | "docx") {
  return api.download(`/packages/${id}/export/${kind}/${format}`, `applymate-${kind}.${format}`,
    format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}
