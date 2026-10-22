export const HISTORY_LIMIT = 200;
const ITEMS = 'translationHistory';
const ENABLED = 'translationHistoryEnabled';
function valid(item) {
  return item && typeof item.id === 'string' && Number.isFinite(item.createdAt)
    && typeof item.source === 'string' && [...item.source].length <= 600
    && typeof item.translation === 'string' && item.translation.length <= 12000
    && ['local', 'api'].includes(item.mode) && ['webllm', 'transformers'].includes(item.engine)
    && ['English', '简体中文'].includes(item.target);
}
export function createHistoryStore(storage, { now = () => Date.now(), makeId = () => crypto.randomUUID() } = {}) {
  let tail = Promise.resolve();
  const serial = action => { const result = tail.then(action); tail = result.catch(() => {}); return result; };
  async function read() {
    const saved = await storage.get([ITEMS, ENABLED]);
    return { enabled: saved[ENABLED] !== false, items: (Array.isArray(saved[ITEMS]) ? saved[ITEMS] : []).filter(valid).slice(0, HISTORY_LIMIT) };
  }
  return {
    list(query = '') { return serial(async () => {
      const data = await read(), term = String(query).slice(0, 200).trim().toLocaleLowerCase();
      return { ...data, total: data.items.length, limit: HISTORY_LIMIT, items: data.items.filter(item => !term || `${item.source}\n${item.translation}`.toLocaleLowerCase().includes(term)) };
    }); },
    add(input) { return serial(async () => {
      const data = await read();
      if (!data.enabled) return false;
      const item = { id: makeId(), createdAt: now(), source: input.source, translation: input.translation, target: input.target, mode: input.mode, engine: input.engine };
      if (!valid(item) || !item.source.trim() || !item.translation.trim()) throw new Error('翻译历史内容无效。');
      const items = data.items.filter(previous => !['source', 'translation', 'target', 'mode', 'engine'].every(key => previous[key] === item[key]));
      await storage.set({ [ITEMS]: [item, ...items].slice(0, HISTORY_LIMIT) });
      return true;
    }); },
    setEnabled(enabled) { return serial(async () => {
      if (typeof enabled !== 'boolean') throw new Error('无效的历史记录设置。');
      await storage.set({ [ENABLED]: enabled }); return enabled;
    }); },
    remove(id) { return serial(async () => {
      const data = await read(); await storage.set({ [ITEMS]: data.items.filter(item => item.id !== id) }); return true;
    }); },
    clear() { return serial(async () => { await storage.set({ [ITEMS]: [] }); return true; }); }
  };
}
