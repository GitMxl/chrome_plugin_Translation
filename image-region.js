export function normalizeOCRText(text) {
  return text.replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '$1').trim();
}
export function imageRegion(start, end, bounds, width, height) {
  if (![bounds.width, bounds.height, width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('截图尺寸无效。');
  const x = value => Math.min(bounds.width, Math.max(0, value - bounds.left));
  const y = value => Math.min(bounds.height, Math.max(0, value - bounds.top));
  const left = Math.floor(Math.min(x(start.x), x(end.x)) * width / bounds.width);
  const top = Math.floor(Math.min(y(start.y), y(end.y)) * height / bounds.height);
  const right = Math.ceil(Math.max(x(start.x), x(end.x)) * width / bounds.width);
  const bottom = Math.ceil(Math.max(y(start.y), y(end.y)) * height / bounds.height);
  if (right - left < 4 || bottom - top < 4) throw new Error('选区太小，请重新框选文字区域。');
  return { left, top, width: right - left, height: bottom - top };
}
