// Load and change life-tracker items of some kinds (see lib/life.js).
import { useCallback, useEffect, useState } from "react";
import { mapLife } from "./life";
import { apiGet, apiPost, apiDelete } from "./api";
import { showToast } from "./toast";

export function useLife(kinds) {
  const key = kinds.join(",");
  const [items, setItems] = useState(null);
  const reload = useCallback(async () => {
    try {
      setItems(((await apiGet("life", { kinds: key })).items || []).map(mapLife));
    } catch (e) {
      showToast(e.message, "⚠️");
      setItems((x) => x || []);
    }
  }, [key]);
  useEffect(() => { reload(); }, [reload]);

  // save({ kind, id?, refId?, date?, data, photo?, vault? })
  const save = useCallback(async (item) => {
    const r = await apiPost({ type: "life", ...item });
    await reload();
    return r.item;
  }, [reload]);
  const remove = useCallback(async (id, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await apiDelete("life", id); await reload(); } catch (e) { showToast(e.message, "⚠️"); }
  }, [reload]);

  const of = useCallback((kind) => (items || []).filter((x) => x.kind === kind), [items]);
  return { items, loaded: items !== null, of, save, remove, reload };
}

// Strip what the API sends back so an item can be saved again.
export function lifeData(item, fields) {
  const out = {};
  for (const f of fields) if (item[f] !== undefined) out[f] = item[f];
  return out;
}
