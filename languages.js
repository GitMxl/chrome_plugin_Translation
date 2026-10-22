// Shared by classic content scripts, extension modules and inference workers.
(() => {
  const targets = Object.freeze([
    ['auto', '自动中英互译', 'auto'],
    ['zh', '简体中文', '简体中文'],
    ['en', '英文（English）', 'English'],
    ['zh-TW', '繁体中文', 'Traditional Chinese'],
    ['ja', '日语', 'Japanese'],
    ['ko', '韩语', 'Korean'],
    ['fr', '法语', 'French'],
    ['de', '德语', 'German'],
    ['es', '西班牙语', 'Spanish'],
    ['pt', '葡萄牙语', 'Portuguese'],
    ['it', '意大利语', 'Italian'],
    ['ru', '俄语', 'Russian'],
    ['ar', '阿拉伯语', 'Arabic'],
    ['hi', '印地语', 'Hindi'],
    ['th', '泰语', 'Thai'],
    ['vi', '越南语', 'Vietnamese'],
    ['id', '印尼语', 'Indonesian'],
    ['tr', '土耳其语', 'Turkish']
  ].map(([code, label, name]) => Object.freeze({ code, label, name })));
  const isTargetLanguage = code => targets.some(target => target.code === code);
  const languageLabel = name => targets.find(target => target.name === name || target.code === name)?.label || name;
  function populateTargets(select, followSettings = false) {
    const previous = select.value;
    const options = followSettings ? [{ code: '', label: '跟随设置' }, ...targets] : targets;
    select.replaceChildren(...options.map(({ code, label }) => {
      const option = select.ownerDocument.createElement('option'); option.value = code; option.textContent = label; return option;
    }));
    select.value = options.some(option => option.code === previous) ? previous : options[0].code;
  }
  globalThis.LocalTranslationLanguages = Object.freeze({ targets, isTargetLanguage, languageLabel, populateTargets });
})();
