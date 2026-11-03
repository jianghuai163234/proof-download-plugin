import './style.css';
import { makeManifest, type Entry, type Naming } from './core.ts';
import { downloadEntries } from './download.ts';
import type { Choice, Context } from './feishu.ts';

const demo = new URLSearchParams(location.search).get('demo') === '1';
const embedded = window.parent !== window;
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <main>
    <header><div class="brand">↓</div><div><h1>校样下载插件</h1><p>当前视图，一键归档</p></div><span class="badge">只读</span></header>
    <div id="demo-banner" class="notice" hidden>演示模式 · 使用虚拟订单和示例图片，不连接飞书</div>
    <section class="card context-card">
      <div class="section-top"><span class="eyebrow">当前页面</span><button id="refresh" class="text-button">刷新识别</button></div>
      <h2 id="shop">正在连接飞书…</h2><p id="view" class="muted">读取当前视图</p>
      <label for="field">下载附件列</label><select id="field" aria-label="下载附件列"></select>
      <p class="hint">跟随你在飞书中设置的筛选，空附件自动跳过。</p>
    </section>
    <section class="card">
      <span class="eyebrow">文件命名</span>
      <div class="naming"><label><input type="radio" name="naming" value="image">image 编号<small>image1、image2…</small></label><label><input type="radio" name="naming" value="buyer">买家姓名<small>1_姓名、2_姓名…</small></label></div>
      <div id="buyer-box" hidden><label for="buyer">姓名来源列</label><select id="buyer"></select></div>
    </section>
    <details class="card" id="extra"><summary>添加其他店铺／视图 <span id="extra-count">0 项</span></summary>
      <p class="hint">当前页面始终包含在任务中。其他视图沿用各自的筛选。</p>
      <label for="search">查找店铺</label><input id="search" type="search" placeholder="输入店铺名称">
      <label for="table-select">店铺</label><select id="table-select"></select>
      <label for="view-select">视图</label><select id="view-select"></select>
      <button id="add" class="secondary">＋ 添加到本次下载</button><ul id="targets" class="targets"></ul>
    </details>
    <div id="order-note" class="notice" hidden>此视图有分组。首次使用请展开下载清单核对上下顺序；当前版本尚待真实飞书验收。</div>
    <div class="actions"><button id="download" class="primary" disabled>一键下载</button><div class="sub-actions"><button id="preview" class="text-button" disabled>只读查看下载清单</button><button id="cancel" class="text-button" hidden>取消任务</button></div></div>
    <section id="status-box" class="card" aria-live="polite"><p id="status">正在初始化…</p><progress id="progress" max="1" value="0" hidden></progress></section>
    <section id="failures-box" class="card error" hidden><h2>未完成的文件</h2><ul id="failures"></ul><p class="hint">请检查权限、网络或文件大小后重试。单文件上限 64 MiB。</p></section>
    <details id="manifest-box" class="card" hidden><summary>下载清单 <span id="manifest-count"></span></summary><ol id="manifest"></ol><p id="manifest-more" class="hint"></p></details>
    <footer>仅在本机处理 · 不修改记录与状态<br>单店铺直接成包 · 多店铺内含各店铺 ZIP<br>每包最多 20 个附件或约 64 MiB，超出自动分包</footer>
  </main>`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function show(id: string, value: boolean) { el(id).hidden = !value; }
function status(text: string, error = false) { el('status').textContent = text; el('status-box').classList.toggle('error', error); }
function options(id: string, values: Choice[], selected?: string, placeholder = '请选择') {
  const select = el<HTMLSelectElement>(id);
  select.replaceChildren(new Option(placeholder, ''), ...values.map(v => new Option(v.name, v.id)));
  if (selected && values.some(v => v.id === selected)) select.value = selected;
}
function savedNaming(): Naming { try { return localStorage.getItem('attachment-downloader.naming') === 'buyer' ? 'buyer' : 'image'; } catch { return 'image'; } }
let naming = savedNaming();
let current: Context | null = null;
let extras: Context[] = [];
let tables: Choice[] = [];
let busy = false, epoch = 0, viewEpoch = 0;
let controller: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let service: typeof import('./feishu.ts') | null = null;
let demoService: typeof import('./demo.ts') | null = null;

async function context(tableId?: string, viewId?: string) {
  if (demoService) return demoService.demoContext(tableId, viewId);
  if (!service) throw new Error('请在飞书自定义插件中打开本页面。');
  return service.getContext(tableId, viewId);
}
function controls() {
  const ready = Boolean(current?.fieldId) && (naming === 'image' || Boolean(current?.buyerFieldId));
  el<HTMLButtonElement>('download').disabled = busy || !ready;
  el<HTMLButtonElement>('preview').disabled = busy || !ready;
  for (const item of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,#add,#refresh')) item.disabled = busy;
  for (const item of root.querySelectorAll<HTMLButtonElement>('#targets button')) item.disabled = busy;
  show('cancel', busy); show('buyer-box', naming === 'buyer');
}
async function refresh() {
  if (busy) return;
  const version = ++epoch;
  el<HTMLButtonElement>('download').disabled = true; el<HTMLButtonElement>('preview').disabled = true;
  try {
    const next = await context();
    if (version !== epoch || busy) return;
    if (current?.tableId === next.tableId && current.viewId === next.viewId) {
      if (next.fields.some(f => f.id === current?.fieldId)) next.fieldId = current.fieldId;
      if (next.buyerFields.some(f => f.id === current?.buyerFieldId)) next.buyerFieldId = current.buyerFieldId;
    }
    current = next;
    el('shop').textContent = next.tableName; el('view').textContent = next.viewName;
    options('field', next.fields, next.fieldId, '未能自动匹配，请选择附件列');
    options('buyer', next.buyerFields, next.buyerFieldId, '请选择姓名来源列');
    extras = extras.filter(e => e.tableId !== next.tableId || e.viewId !== next.viewId); renderExtras();
    show('order-note', next.grouped); show('manifest-box', false);
    status(next.fieldId ? '已识别当前视图，点击即可读取最新筛选结果并下载。' : '视图名称未能匹配目标字段，请手动选择附件列。');
  } catch {
    if (version !== epoch) return;
    current = null;
    el('shop').textContent = '尚未连接表格'; el('view').textContent = '请打开店铺订单表格后刷新';
    status('无法读取当前视图。请确认在飞书侧边栏中打开、当前为表格视图，且具有读取权限。', true);
  }
  controls();
}
function renderExtras() {
  el('extra-count').textContent = `${extras.length} 项`;
  const list = el('targets'); list.replaceChildren();
  for (const [i, item] of extras.entries()) {
    const li = document.createElement('li'); const title = document.createElement('span');
    title.textContent = `${item.tableName} / ${item.viewName}`;
    const remove = document.createElement('button'); remove.textContent = '移除'; remove.className = 'text-button';
    remove.disabled = busy; remove.onclick = () => { extras.splice(i, 1); renderExtras(); };
    li.append(title, remove); list.append(li);
  }
}
function filterTables() {
  const search = el<HTMLInputElement>('search').value.trim().toLocaleLowerCase();
  const filtered = tables.filter(t => t.name.toLocaleLowerCase().includes(search));
  options('table-select', filtered, filtered.find(t => t.id === current?.tableId)?.id || filtered[0]?.id);
  void loadViews();
}
async function loadViews() {
  const version = ++viewEpoch, tableId = el<HTMLSelectElement>('table-select').value;
  options('view-select', [], undefined, '正在读取视图…');
  if (!tableId) return;
  try {
    const values = demoService ? demoService.demoViews : await service!.getViews(tableId);
    if (version !== viewEpoch) return;
    options('view-select', values, values.find(v => v.name.includes('新收到校样') || v.name.includes('修改'))?.id);
  } catch { if (version === viewEpoch) { options('view-select', [], undefined, '读取失败'); status('无法读取该店铺的视图，请检查权限。', true); } }
}
async function addExtra() {
  const tableId = el<HTMLSelectElement>('table-select').value, viewId = el<HTMLSelectElement>('view-select').value;
  if (!tableId || !viewId || busy) return;
  try {
    const item = await context(tableId, viewId);
    if (busy) return;
    if (!item.fieldId) throw new Error('该视图未匹配到校样1或最新校样，请先在该视图中下载。');
    if ((current?.tableId === tableId && current.viewId === viewId) || extras.some(e => e.tableId === tableId && e.viewId === viewId)) { status('该视图已经在下载范围中。'); return; }
    extras.push(item); renderExtras(); status('已添加，点击一键下载将按列表顺序处理。');
  } catch { status('添加失败：请确认该视图可读取，且含对应的校样附件列。', true); }
}
function renderManifest(entries: Entry[]) {
  const list = el('manifest'); list.replaceChildren();
  for (const entry of entries.slice(0, 200)) {
    const li = document.createElement('li'); li.textContent = `${entry.tableName} / ${entry.viewName} / ${entry.filename}`; list.append(li);
  }
  el('manifest-count').textContent = `${entries.length} 个附件`;
  el('manifest-more').textContent = entries.length > 200 ? '面板仅预览前 200 个，实际处理全部附件。' : '编号已按记录读取顺序确定，失败项不会导致后续文件重新编号。';
  show('manifest-box', true);
}
async function saveZip(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {type:'application/zip'});
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  // Give the browser time to claim the Blob before releasing each batch.
  await new Promise(resolve => setTimeout(resolve, 300)); URL.revokeObjectURL(url);
}
async function run(previewOnly: boolean) {
  if (busy || !current?.fieldId) return;
  show('failures-box', false); el('failures').replaceChildren();
  busy = true; epoch++; controller = new AbortController(); controls();
  const signal = controller.signal;
  const tasks = [structuredClone(current), ...structuredClone(extras)];
  const taskNaming = naming;
  show('progress', true); el<HTMLProgressElement>('progress').removeAttribute('value');
  try {
    const active = await context();
    signal.throwIfAborted();
    if (active.tableId !== tasks[0].tableId || active.viewId !== tasks[0].viewId) throw new Error('当前页面已经切换，请等待自动识别后重试。');
    const entries: Entry[] = [];
    for (const [i, task] of tasks.entries()) {
      signal.throwIfAborted(); status(`读取 ${i + 1}/${tasks.length}：${task.tableName} · ${task.viewName}`);
      const fresh = await context(task.tableId, task.viewId);
      if (!fresh.fields.some(f => f.id === task.fieldId)) throw new Error('附件列已变化');
      if (taskNaming === 'buyer' && !fresh.buyerFields.some(f => f.id === task.buyerFieldId)) throw new Error('买家姓名列不可用');
      const rows = demoService ? await demoService.demoRows(task, taskNaming, signal) : await service!.readContextRows(task, taskNaming, signal);
      entries.push(...makeManifest(task, rows, taskNaming));
      if (entries.length > 10000) throw new Error('附件数量超过一万，请缩小范围');
    }
    signal.throwIfAborted(); renderManifest(entries);
    if (!entries.length) { status('当前筛选结果没有目标附件，未生成下载文件。'); return; }
    if (previewOnly) { status(`已读取 ${tasks.length} 个视图、${entries.length} 个附件；此操作未下载文件。`); el<HTMLDetailsElement>('manifest-box').open = true; return; }
    const progress = el<HTMLProgressElement>('progress'); progress.max = entries.length; progress.value = 0;
    const result = await downloadEntries(entries, {load: demoService ? demoService.demoLoad : service!.loadAttachment, save:saveZip, progress:(done,total,failed) => {progress.value = done; status(`处理 ${done}/${total} · 失败 ${failed} 个`);}}, signal, tasks);
    const failures = el('failures');
    for (const item of result.failures) {
      const li = document.createElement('li'); li.textContent = `${item.tableName} / ${item.viewName} / ${item.filename}`; failures.append(li);
    }
    show('failures-box', result.failures.length > 0);
    status(`已打包 ${result.success} 个附件，失败 ${result.failed} 个，已发起 ${result.parts} 个 ZIP 下载。请检查浏览器下载列表；失败项在下方面板显示，压缩包不包含 TXT。`, result.failed > 0);
  } catch {
    status(signal.aborted ? '任务已取消。已发起的 ZIP 下载可能仍会完成，其余附件未继续处理。' : '任务未完成：请检查表格权限、目标列或筛选是否发生变化。可先用“只读查看下载清单”核对；不会退回下载整张表。', !signal.aborted);
  } finally {
    busy = false; controller = null; show('progress', false); controls();
    // Selection events during a running task cannot change its frozen manifest.
    // Reconcile once afterwards so the next click follows the newly active page.
    try {
      const active = await context();
      if (active.tableId !== current?.tableId || active.viewId !== current?.viewId) await refresh();
    } catch { current = null; controls(); }
  }
}

for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="naming"]')) {
  radio.checked = radio.value === naming;
  radio.onchange = () => { naming = radio.value as Naming; try { localStorage.setItem('attachment-downloader.naming', naming); } catch { /* Storage may be restricted by the host. */ } controls(); show('manifest-box', false); };
}
el<HTMLSelectElement>('field').onchange = () => { if (current) current.fieldId = el<HTMLSelectElement>('field').value; controls(); show('manifest-box', false); };
el<HTMLSelectElement>('buyer').onchange = () => { if (current) current.buyerFieldId = el<HTMLSelectElement>('buyer').value; controls(); show('manifest-box', false); };
el('refresh').onclick = () => void refresh();
el('search').oninput = filterTables; el('table-select').onchange = () => void loadViews();
el('add').onclick = () => void addExtra();
el('preview').onclick = () => void run(true); el('download').onclick = () => void run(false);
el('cancel').onclick = () => controller?.abort();
el<HTMLDetailsElement>('extra').ontoggle = async () => {
  if (!el<HTMLDetailsElement>('extra').open || tables.length || busy) return;
  try { tables = demoService ? demoService.demoTables : await service!.getTables(); filterTables(); }
  catch { status('店铺列表读取失败，请检查权限。', true); }
};

async function init() {
  show('demo-banner', demo);
  if (!demo && !embedded) {
    el('shop').textContent = '请从飞书侧边栏打开'; el('view').textContent = '这里是插件服务页面';
    status('在飞书“自定义插件”中添加本页面地址。想先看效果，可访问当前地址加 ?demo=1；演示不读取真实表格。');
    return;
  }
  if (demo) demoService = await import('./demo.ts');
  else {
    service = await import('./feishu.ts');
    const off = service.watchSelection(() => {
      if (!busy) { el<HTMLButtonElement>('download').disabled = true; el<HTMLButtonElement>('preview').disabled = true; }
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 250);
    });
    window.addEventListener('pagehide', off, {once:true});
  }
  await refresh();
}
void init().catch(() => status('插件初始化失败，请关闭后重新打开。', true));
