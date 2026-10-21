/* 施工单 Pro —— 与 gongdan-vercel 共用同一套 Supabase 数据 */
'use strict';

// ===================== 配置 =====================
const SUPABASE_URL = 'https://umatcwaodotqpttbuwew.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ULquGaSNnY9G11RJcKLx_g_Xmcev2ig';
const USER_DOMAIN = '@gongdan.local';
const AI_ENDPOINT = '/api/ai';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ===================== 常量 =====================
const CATEGORIES = ['汽车玻璃膜', '汽车改色膜', '隐形车衣', '汽车脚垫', '汽车360全景影像', '汽车内饰改装', '氛围灯', '方向套', '其他项目'];

// 常用项目模板（含耗材与单耗，用于自动扣库存）
const PRESETS = [
    { cat: '汽车玻璃膜', name: '前挡风玻璃贴膜', price: 800, w: 5, mat: '前挡膜', cost: 1 },
    { cat: '汽车玻璃膜', name: '侧后挡贴膜', price: 900, w: 5, mat: '侧后挡膜', cost: 1 },
    { cat: '汽车玻璃膜', name: '全车玻璃膜', price: 1600, w: 5, mat: '全车玻璃膜', cost: 1 },
    { cat: '隐形车衣', name: '全车车衣 TPU', price: 6800, w: 8, mat: 'TPU车衣卷', cost: 1.2 },
    { cat: '隐形车衣', name: '前杠车衣', price: 1200, w: 8, mat: 'TPU车衣卷', cost: 0.3 },
    { cat: '隐形车衣', name: '机盖车衣', price: 1500, w: 8, mat: 'TPU车衣卷', cost: 0.4 },
    { cat: '汽车改色膜', name: '全车改色膜', price: 3800, w: 3, mat: '改色膜卷', cost: 1.2 },
    { cat: '汽车改色膜', name: '局部改色(后视镜/车顶)', price: 600, w: 3, mat: '改色膜卷', cost: 0.2 },
    { cat: '氛围灯', name: '64色主动式氛围灯', price: 1800, w: 2, mat: '氛围灯套件', cost: 1 },
    { cat: '汽车脚垫', name: '360航空软包脚垫', price: 1280, w: 2, mat: '软包脚垫套件', cost: 1 },
    { cat: '汽车360全景影像', name: '360全景影像', price: 2600, w: 2, mat: '全景影像套件', cost: 1 },
    { cat: '其他项目', name: '大灯升级/改装', price: 2200, w: 2, mat: '大灯总成', cost: 2 }
];

const DEFAULT_STOCK = [
    { name: '前挡膜', unit: '卷', qty: 10 },
    { name: '侧后挡膜', unit: '卷', qty: 10 },
    { name: '全车玻璃膜', unit: '套', qty: 5 },
    { name: 'TPU车衣卷', unit: '卷', qty: 20 },
    { name: '改色膜卷', unit: '卷', qty: 15 },
    { name: '氛围灯套件', unit: '套', qty: 8 },
    { name: '软包脚垫套件', unit: '套', qty: 12 },
    { name: '全景影像套件', unit: '套', qty: 5 },
    { name: '大灯总成', unit: '只', qty: 10 }
];

const PHOTO_TAGS = ['施工前 1', '施工前 2', '施工前 3', '施工后 1', '施工后 2', '施工后 3'];

// ===================== 状态 =====================
const state = {
    userId: '',
    username: '',
    items: [],
    photos: ['', '', '', '', '', ''],
    orders: [],
    stock: [],
    hasExtraCols: false,   // work_orders 是否已扩展 customer_phone 等列
    stockCloud: false,     // inventory 表是否可用
    pendingPhotoIndex: -1,
    currentOrder: null
};

// ===================== 工具 =====================
const $ = (id) => document.getElementById(id);

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeImgSrc(src) {
    if (typeof src !== 'string' || !src) return '';
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src)) return src;
    if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
    return '';
}

function parseMoney(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    const n = Number(s);
    if (!Number.isFinite(n) || n > 10000000) return NaN;
    return Math.round(n * 100) / 100;
}

const fmtMoney = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0';
};

function show(msg) {
    $('alertText').textContent = msg;
    $('alertMask').hidden = false;
}

let confirmResolve = null;

function closeConfirm(value) {
    $('confirmMask').hidden = true;
    const done = confirmResolve;
    confirmResolve = null;
    if (done) done(value);
}

function ask(msg) {
    return new Promise((resolve) => {
        closeConfirm(false);
        $('confirmText').textContent = msg;
        $('confirmMask').hidden = false;
        confirmResolve = resolve;
    });
}

function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function compressImage(base64Str, maxWidth = 800, quality = 0.6) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onerror = () => resolve('');
        img.onload = () => {
            try {
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;
                if (!w || !h) { resolve(''); return; }
                if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (e) { resolve(''); }
        };
        img.src = base64Str;
    });
}

const isValidImage = (f) => !!f && /^image\//.test(f.type || '') && f.size <= MAX_UPLOAD_BYTES;

function readAsDataURL(file) {
    return new Promise((resolve) => {
        const r = new FileReader();
        r.onerror = () => resolve('');
        r.onload = (e) => resolve(String(e.target.result || ''));
        r.readAsDataURL(file);
    });
}

// ===================== 登录 =====================
const toEmail = (u) => u.trim().toLowerCase() + USER_DOMAIN;

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
    $('loginForm').hidden = tab !== 'login';
    $('registerForm').hidden = tab !== 'register';
    $('loginMsg').textContent = '';
    $('regMsg').textContent = '';
}

async function doRegister() {
    const user = $('regUser').value.trim();
    const pass = $('regPass').value;
    const msg = $('regMsg');
    msg.style.color = '#ef4444';

    if (!/^[A-Za-z0-9_-]{2,20}$/.test(user)) { msg.textContent = '账号需 2-20 位，只能用字母、数字、下划线、短横线'; return; }
    if (pass.length < 6) { msg.textContent = '密码至少 6 位'; return; }

    msg.textContent = '正在注册...';
    try {
        const { data, error } = await sb.auth.signUp({
            email: toEmail(user), password: pass, options: { data: { username: user } }
        });
        if (error) {
            const dup = /already|registered|exists/i.test(error.message || '') || error.status === 422;
            msg.textContent = dup ? '该账号已被占用，请换一个' : '注册失败：' + (error.message || '未知错误');
            return;
        }
        if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            msg.textContent = '该账号已被占用，请换一个';
            return;
        }
        if (data.session) { enterApp(data.session); return; }
        msg.style.color = '#f59e0b';
        msg.textContent = '账号已创建，请到 Supabase 后台关闭邮件确认后登录';
    } catch (e) {
        msg.textContent = '注册失败，请稍后重试';
    }
}

async function doLogin() {
    const user = $('loginUser').value.trim();
    const pass = $('loginPass').value;
    const msg = $('loginMsg');
    msg.style.color = '#ef4444';
    if (!user || !pass) { msg.textContent = '请输入账号密码'; return; }

    msg.textContent = '正在登录...';
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(user), password: pass });
        if (error) {
            msg.textContent = /invalid/i.test(error.message || '') ? '账号或密码错误' : '登录失败：' + (error.message || '未知错误');
            return;
        }
        msg.textContent = '';
        $('loginPass').value = '';
        enterApp(data.session);
    } catch (e) {
        msg.textContent = '登录失败，请稍后重试';
    }
}

async function enterApp(session) {
    state.userId = session.user.id;
    const meta = session.user.user_metadata || {};
    state.username = meta.username || String(session.user.email || '').split('@')[0];
    $('authWrap').hidden = true;
    $('appWrap').hidden = false;
    $('brandSub').textContent = `${state.username} · 云端同步`;
    $('workDate').value = todayStr();
    await afterLogin();
}

async function doLogout() {
    if (!await ask('确定要退出当前账号吗？')) return;
    try { await sb.auth.signOut(); } catch (e) { /* 忽略网络异常，前端同样清理 */ }
    location.reload();
}

// ===================== 登录后初始化 =====================
async function afterLogin() {
    await Promise.all([probeSchema(), loadStock()]);
    renderPresets();
    renderPhotos();
    restoreDraft();
    loadOrders();
}

/** 探测 work_orders 扩展列与 inventory 表是否存在（不存在则自动降级） */
async function probeSchema() {
    const { error } = await sb.from('work_orders').select('customer_phone').limit(1);
    state.hasExtraCols = !error;

    const inv = await sb.from('inventory').select('name').limit(1);
    state.stockCloud = !inv.error;
    $('stockMode').textContent = state.stockCloud ? '云端' : '本地（未建表）';
}

// ===================== 视图切换 =====================
function switchView(view) {
    ['create', 'orders', 'stock', 'stats'].forEach((v) => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
    window.scrollTo(0, 0);
    if (view === 'orders' && state.orders.length === 0) loadOrders();
    if (view === 'stats') renderStats();
}

// ===================== 开单页 =====================
function renderPresets() {
    $('itemCategory').innerHTML = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('presetBox').innerHTML = PRESETS.map((p, i) =>
        `<button class="chip" data-preset="${i}">${esc(p.name)}<b>￥${fmtMoney(p.price)}</b></button>`
    ).join('');
    document.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.onclick = () => {
            const p = PRESETS[Number(btn.dataset.preset)];
            $('itemCategory').value = p.cat;
            $('itemPart').value = p.name;
            $('itemPrice').value = p.price;
            $('warrantyNum').value = p.w;
            $('warrantyUnit').value = '年';
            $('itemBrand').focus();
        };
    });
}

function findPreset(cat, part) {
    const t = String(part || '').trim();
    return PRESETS.find((p) => p.cat === cat && (p.name === t || p.name.includes(t) || t.includes(p.name))) || null;
}

function addItem() {
    const cat = $('itemCategory').value;
    const part = $('itemPart').value.trim();
    const brand = $('itemBrand').value.trim().slice(0, 40);
    const price = parseMoney($('itemPrice').value);

    if (!part) { show('请输入施工部位'); return; }
    if (!Number.isFinite(price)) { show('请输入有效价格（最多两位小数）'); return; }

    let warranty = '';
    const num = $('warrantyNum').value.trim();
    const unit = $('warrantyUnit').value;
    if (unit === '终身') warranty = '终身质保';
    else if (num) warranty = num + unit;

    const preset = findPreset(cat, part);
    state.items.push({
        category: cat,
        brand,
        part: part.slice(0, 40),
        price,
        warranty: warranty.slice(0, 20),
        mat: preset ? preset.mat : '',
        cost: preset ? preset.cost : 0
    });

    $('itemBrand').value = '';
    $('itemPart').value = '';
    $('itemPrice').value = '';
    renderItems();
}

function renderItems() {
    const box = $('itemList');
    $('emptyTip').hidden = state.items.length > 0;
    $('itemCount').textContent = state.items.length;
    $('totalBox').hidden = state.items.length === 0;

    let total = 0;
    box.innerHTML = state.items.map((it, i) => {
        total += it.price;
        const brand = it.brand ? `<span style="color:#3b82f6">[${esc(it.brand)}]</span> ` : '';
        return `<div class="item-row">
            <div class="item-main">
                <div class="item-cat">${esc(it.category)}</div>
                <div class="item-sub">${brand}${esc(it.part)} ｜ 质保${esc(it.warranty || '无')}</div>
            </div>
            <div class="item-price">￥${esc(fmtMoney(it.price))}</div>
            <div class="item-del" data-del="${i}">✕</div>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-del]').forEach((el) => {
        el.onclick = () => { state.items.splice(Number(el.dataset.del), 1); renderItems(); };
    });
    $('totalAmount').textContent = '￥' + fmtMoney(total);
}

function renderPhotos() {
    const grid = $('photoGrid');
    grid.innerHTML = state.photos.map((src, i) => `
        <div class="photo-box" data-slot="${i}">
            ${src ? `<img src="${esc(safeImgSrc(src))}" alt=""><div class="photo-del" data-delphoto="${i}">✕</div>` : ''}
            <div class="photo-tag">${esc(PHOTO_TAGS[i])}</div>
            ${src ? '' : '<div class="photo-plus"><i>＋</i>点击拍照</div>'}
        </div>`).join('');

    grid.querySelectorAll('[data-slot]').forEach((box) => {
        box.onclick = (e) => {
            const i = Number(box.dataset.slot);
            if (e.target.dataset.delphoto !== undefined) {
                state.photos[i] = '';
                renderPhotos();
                return;
            }
            if (state.photos[i]) { openLightbox(state.photos[i]); return; }
            state.pendingPhotoIndex = i;
            $('photoFile').click();
        };
    });
}

function openLightbox(src) {
    const safe = safeImgSrc(src);
    if (!safe) return;
    $('lightboxImg').src = safe;
    $('lightbox').hidden = false;
}

async function onPhotoPicked(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!isValidImage(file)) { show('请选择 15MB 以内的图片'); return; }

    const raw = await readAsDataURL(file);
    const compressed = await compressImage(raw);
    if (!compressed) { show('图片读取失败，请重试'); return; }

    const i = state.pendingPhotoIndex;
    if (i < 0) return;
    state.photos[i] = compressed;
    state.pendingPhotoIndex = -1;
    renderPhotos();
    saveDraft();
}

// ---- AI 识别 ----
async function runAIScan() {
    const file = $('aiFile').files && $('aiFile').files[0];
    $('aiFile').value = '';
    if (!file) return;
    if (!isValidImage(file)) { show('请选择 15MB 以内的图片'); return; }

    const btn = $('btnAi');
    btn.disabled = true;
    btn.textContent = '⏳ AI 识别中，请稍候...';
    try {
        const raw = await readAsDataURL(file);
        const image = await compressImage(raw, 1024, 0.8);
        if (!image) throw new Error('图片读取失败，请重新拍摄');

        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error('登录已失效，请重新登录');

        const resp = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ image })
        });
        if (!resp.ok) {
            let detail = '请求失败 ' + resp.status;
            try { const b = await resp.json(); if (b && b.error) detail = b.error; } catch (_) { /* 非 JSON */ }
            throw new Error(resp.status === 404 ? '未找到 /api/ai 服务，请确认已部署 ai 函数' : detail);
        }

        const r = await resp.json();
        const pick = (v, max) => {
            const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
            return (s && s !== '未识别') ? s : '';
        };
        const plate = pick(r.plate, 20);
        const model = pick(r.model, 40);
        if (plate) $('carPlate').value = plate;
        if (model) $('carModel').value = model;
        show(plate || model ? '✅ 识别完成，请核对车牌与车型' : '⚠️ 未能识别，请手动填写');
    } catch (err) {
        show('❌ 识别失败：' + (err && err.message ? err.message : '未知错误'));
    } finally {
        btn.disabled = false;
        btn.textContent = '📷 AI 拍照识别车牌 / 车型';
    }
}

// ---- 草稿 ----
const draftKey = () => `gongdan_pro_draft_${state.userId}`;

function saveDraft() {
    if (!state.userId) return;
    const draft = {
        plate: $('carPlate').value,
        model: $('carModel').value,
        phone: $('custPhone').value,
        date: $('workDate').value,
        remark: $('remark').value,
        items: state.items,
        photos: state.photos
    };
    try {
        localStorage.setItem(draftKey(), JSON.stringify(draft));
    } catch (e) {
        try { localStorage.setItem(draftKey(), JSON.stringify({ ...draft, photos: ['', '', '', '', '', ''] })); } catch (_) { /* 存储已满，放弃草稿 */ }
    }
}

function restoreDraft() {
    let raw = '';
    try { raw = localStorage.getItem(draftKey()) || ''; } catch (e) { raw = ''; }
    if (!raw) return;
    try {
        const d = JSON.parse(raw);
        if (!d || (!d.plate && !d.model && (!d.items || d.items.length === 0))) return;
        $('carPlate').value = d.plate || '';
        $('carModel').value = d.model || '';
        $('custPhone').value = d.phone || '';
        $('workDate').value = d.date || todayStr();
        $('remark').value = d.remark || '';
        state.items = Array.isArray(d.items) ? d.items : [];
        state.photos = (Array.isArray(d.photos) && d.photos.length === 6) ? d.photos : ['', '', '', '', '', ''];
        renderItems();
        renderPhotos();
        $('draftTip').hidden = false;
        $('draftTip').textContent = '已恢复上次未提交的草稿';
    } catch (e) { /* 草稿损坏则忽略 */ }
}

function clearForm() {
    ['carPlate', 'carModel', 'custPhone', 'remark', 'itemBrand', 'itemPart', 'itemPrice'].forEach((id) => { $(id).value = ''; });
    $('workDate').value = todayStr();
    state.items = [];
    state.photos = ['', '', '', '', '', ''];
    renderItems();
    renderPhotos();
    try { localStorage.removeItem(draftKey()); } catch (e) { /* 忽略 */ }
    $('draftTip').hidden = true;
}

// ---- 保存单据 ----
async function saveOrder() {
    const plate = $('carPlate').value.trim();
    const model = $('carModel').value.trim();
    if (!plate) { show('请输入车牌号'); return; }
    if (state.items.length === 0) { show('请至少添加一个施工项目'); return; }
    if (!state.userId) { show('登录状态已失效，请重新登录'); return; }

    const total = state.items.reduce((s, it) => s + it.price, 0);
    if (!Number.isFinite(total) || total < 0 || total > 1e9) { show('金额超出允许范围，请检查清单'); return; }

    const btn = $('btnSave');
    btn.disabled = true;
    btn.textContent = '☁️ 正在上传...';

    const cover = state.photos.find((p) => p) || null;
    const base = {
        user_id: state.userId,
        username: state.username,
        car_plate: plate.slice(0, 20),
        car_model: model.slice(0, 40),
        total_amount: Math.round(total * 100) / 100,
        items: state.items,
        photos: state.photos,
        cover_photo: cover
    };

    try {
        let error;
        if (state.hasExtraCols) {
            const extra = {
                customer_phone: $('custPhone').value.trim().slice(0, 20) || null,
                work_date: $('workDate').value || null,
                remark: $('remark').value.trim().slice(0, 200) || null
            };
            ({ error } = await sb.from('work_orders').insert([{ ...base, ...extra }]));
        } else {
            ({ error } = await sb.from('work_orders').insert([base]));
        }
        if (error) throw error;

        if ($('deductStock').checked) {
            await deductStock(state.items);
            await saveStock();
        }

        clearForm();
        state.orders = [];
        show('✅ 单据已保存到云端');
        loadOrders();
    } catch (err) {
        show('保存失败：' + (err && err.message ? err.message : '未知错误'));
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 保存到云端';
    }
}

// ===================== 库存 =====================
const stockKey = () => `gongdan_pro_stock_${state.userId}`;

async function loadStock() {
    if (state.stockCloud && state.userId) {
        const { data, error } = await sb.from('inventory').select('name,unit,qty').eq('user_id', state.userId);
        if (!error && Array.isArray(data) && data.length > 0) {
            state.stock = data.map((r) => ({ name: r.name, unit: r.unit || '件', qty: Number(r.qty) || 0 }));
            renderStock();
            return;
        }
    }
    let local = null;
    try { local = JSON.parse(localStorage.getItem(stockKey()) || 'null'); } catch (e) { local = null; }
    state.stock = (Array.isArray(local) && local.length) ? local : DEFAULT_STOCK.map((s) => ({ ...s }));
    renderStock();
}

function renderStock() {
    $('stockList').innerHTML = state.stock.map((s, i) => `
        <div class="stock-row">
            <div class="stock-name">${esc(s.name)}<span style="color:#94a3b8;font-weight:400"> / ${esc(s.unit || '件')}</span></div>
            <div class="stepper">
                <button data-stock="-1" data-i="${i}">−</button>
                <button data-stock="1" data-i="${i}">＋</button>
            </div>
            <div class="stock-qty ${Number(s.qty) <= 2 ? 'low' : ''}">${esc(fmtMoney(s.qty))}</div>
            <div class="stock-del" data-stockdel="${i}">✕</div>
        </div>`).join('');

    $('stockList').querySelectorAll('[data-stock]').forEach((b) => {
        b.onclick = () => {
            const i = Number(b.dataset.i);
            const d = Number(b.dataset.stock);
            state.stock[i].qty = Math.max(0, Math.round((Number(state.stock[i].qty) + d) * 100) / 100);
            renderStock();
            saveStock();
        };
    });
    $('stockList').querySelectorAll('[data-stockdel]').forEach((b) => {
        b.onclick = async () => {
            const i = Number(b.dataset.stockdel);
            if (!await ask(`删除耗材「${state.stock[i].name}」？`)) return;
            state.stock.splice(i, 1);
            renderStock();
            saveStock();
        };
    });
}

async function deductStock(items) {
    items.forEach((it) => {
        if (!it.mat || !it.cost) return;
        const row = state.stock.find((s) => s.name === it.mat);
        if (!row) return;
        row.qty = Math.max(0, Math.round((Number(row.qty) - Number(it.cost)) * 100) / 100);
    });
}

async function saveStock() {
    try { localStorage.setItem(stockKey(), JSON.stringify(state.stock)); } catch (e) { /* 忽略配额错误 */ }
    if (!state.stockCloud || !state.userId) return;
    const rows = state.stock.map((s) => ({
        user_id: state.userId, name: s.name, unit: s.unit || '件', qty: Number(s.qty) || 0, updated_at: new Date().toISOString()
    }));
    const { error } = await sb.from('inventory').upsert(rows, { onConflict: 'user_id,name' });
    if (error) {
        state.stockCloud = false;
        $('stockMode').textContent = '本地（云端写入失败）';
    }
}

async function addStockItem() {
    const name = prompt('耗材名称，例如：TPU车衣卷');
    if (!name) return;
    const n = String(name).trim().slice(0, 30);
    if (!n || state.stock.some((s) => s.name === n)) { show('名称为空或已存在'); return; }
    state.stock.push({ name: n, unit: '件', qty: 0 });
    renderStock();
    await saveStock();
}

// ===================== 订单记录 =====================
async function loadOrders() {
    const list = $('orderList');
    list.innerHTML = '<div class="empty">正在拉取云端数据...</div>';
    try {
        if (!state.userId) throw new Error('登录状态已失效，请重新登录');
        const { data, error } = await sb.from('work_orders')
            .select('id, created_at, car_plate, car_model, total_amount, items, cover_photo')
            .eq('user_id', state.userId)
            .order('created_at', { ascending: false })
            .limit(1000);
        if (error) throw error;
        state.orders = Array.isArray(data) ? data : [];
        renderOrders();
    } catch (err) {
        list.innerHTML = `<div class="empty">获取失败：${esc(err && err.message ? err.message : '未知错误')}</div>`;
    }
}

function filteredOrders() {
    const kw = $('orderSearch').value.trim().toLowerCase();
    const range = $('orderRange').value;
    const now = new Date();
    return state.orders.filter((o) => {
        if (range !== 'all') {
            const t = new Date(o.created_at);
            const days = (now - t) / 86400000;
            if (range === 'week' && days > 7) return false;
            if (range === 'month' && (t.getMonth() !== now.getMonth() || t.getFullYear() !== now.getFullYear())) return false;
        }
        if (!kw) return true;
        const items = Array.isArray(o.items) ? o.items.map((i) => `${i.category}${i.part}${i.brand || ''}`).join('') : '';
        return `${o.car_plate || ''}${o.car_model || ''}${items}`.toLowerCase().includes(kw);
    });
}

function renderOrders() {
    const rows = filteredOrders();
    const box = $('orderList');
    if (rows.length === 0) { box.innerHTML = '<div class="empty">暂无订单记录</div>'; return; }

    box.innerHTML = rows.map((o) => {
        const cover = safeImgSrc(o.cover_photo);
        const items = Array.isArray(o.items) ? o.items : [];
        const first = items.length ? (items[0].category || '项目') : '项目';
        const extra = items.length > 1 ? ` 共${items.length}项` : '';
        const coverHtml = cover
            ? `<img class="order-cover" src="${esc(cover)}" alt="">`
            : '<div class="order-cover order-cover-empty">🚗</div>';
        return `<div class="order-card" data-order="${esc(o.id)}">
            ${coverHtml}
            <div class="order-info">
                <div class="order-plate">${esc(o.car_plate || '未填写')}</div>
                <div class="order-model">${esc(o.car_model || '')}</div>
                <div class="order-meta">${esc(first)}${esc(extra)}</div>
                <div class="order-time">${esc(new Date(o.created_at).toLocaleString())}</div>
            </div>
            <div class="order-amount">￥${esc(fmtMoney(o.total_amount))}</div>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-order]').forEach((el) => {
        el.onclick = () => viewOrder(el.dataset.order);
    });
    box.querySelectorAll('.order-cover').forEach((img) => {
        img.onerror = () => { img.style.visibility = 'hidden'; };
    });
}

async function viewOrder(id) {
    try {
        const cols = 'id, created_at, car_plate, car_model, total_amount, items, photos'
            + (state.hasExtraCols ? ', customer_phone, work_date, remark' : '');
        const { data, error } = await sb.from('work_orders')
            .select(cols)
            .eq('id', id).eq('user_id', state.userId).maybeSingle();
        if (error) throw error;
        if (!data) { show('订单不存在或无权查看'); return; }
        renderDetail(data);
    } catch (e) {
        show('获取详情失败，请稍后重试');
    }
}

function renderDetail(o) {
    state.currentOrder = o;
    $('dPlate').textContent = o.car_plate || '未填写车牌';
    $('dModel').textContent = o.car_model || '';
    $('dTime').textContent = (o.work_date ? o.work_date + ' ' : '') + new Date(o.created_at).toLocaleString();
    $('dPhone').textContent = o.customer_phone || '—';

    const items = Array.isArray(o.items) ? o.items : [];
    $('dItems').innerHTML = items.map((it) => `
        <div class="sheet-item">
            <div>
                <div class="sheet-item-cat">${esc(it.category || '')}</div>
                <div class="sheet-item-sub">品牌：${esc(it.brand || '无')} ｜ 部位：${esc(it.part || '无')} ｜ 质保：${esc(it.warranty || '无')}</div>
            </div>
            <div class="sheet-item-price">￥${esc(fmtMoney(it.price))}</div>
        </div>`).join('');

    const remark = o.remark ? String(o.remark) : '';
    $('dRemark').hidden = !remark;
    $('dRemark').textContent = remark ? '备注：' + remark : '';
    $('dTotal').textContent = '￥' + fmtMoney(o.total_amount);

    $('dPhotos').innerHTML = PHOTO_TAGS.map((tag, i) => {
        const src = (Array.isArray(o.photos) && typeof o.photos[i] === 'string') ? safeImgSrc(o.photos[i]) : '';
        return `<div class="photo-box" data-photo="${esc(src)}">
            ${src ? '<img src="' + esc(src) + '" alt="">' : '<div class="photo-plus"><i>·</i>无</div>'}
            <div class="photo-tag">${esc(tag)}</div>
        </div>`;
    }).join('');
    $('dPhotos').querySelectorAll('[data-photo]').forEach((b) => {
        b.onclick = () => openLightbox(b.dataset.photo);
    });

    $('detailMask').hidden = false;
}

async function deleteCurrentOrder() {
    const o = state.currentOrder;
    if (!o) return;
    if (!await ask('确定永久删除这条订单？删除后无法恢复！')) return;
    const { error, count } = await sb.from('work_orders').delete({ count: 'exact' }).eq('id', o.id).eq('user_id', state.userId);
    if (error) { show('删除失败：' + error.message); return; }
    if (!count) { show('订单不存在或无权限删除'); return; }
    $('detailMask').hidden = true;
    state.currentOrder = null;
    await loadOrders();
    show('✅ 订单已删除');
}

function orderToText(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    const lines = items.map((it, i) =>
        `${i + 1}. 【${it.category || ''}】\n   品牌：${it.brand || '无'} ｜ 部位：${it.part || '无'}\n   价格：￥${fmtMoney(it.price)} 元（质保${it.warranty || '无'}）\n`
    ).join('');
    return [
        '车辆施工单',
        '==================================',
        `车牌号：${o.car_plate || '未填'}`,
        `车型：${o.car_model || '未填'}`,
        `施工时间：${(o.work_date ? o.work_date + ' ' : '')}${new Date(o.created_at).toLocaleString()}`,
        o.customer_phone ? `车主电话：${o.customer_phone}` : '',
        '==================================',
        '施工项目明细：',
        lines,
        '----------------------------------',
        `总计金额：￥${fmtMoney(o.total_amount)} 元`,
        o.remark ? `备注：${o.remark}` : '',
        '==================================',
        '（此单据由系统自动生成）'
    ].filter(Boolean).join('\n');
}

async function copyText() {
    const ta = $('printText');
    ta.select();
    ta.setSelectionRange(0, 99999);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(ta.value);
        } else {
            document.execCommand('copy');
        }
        $('printMask').hidden = true;
        show('✅ 已复制，可粘贴发微信');
    } catch (e) {
        show('❌ 复制失败，请长按手动选择');
    }
}

function exportSummary() {
    const rows = filteredOrders();
    if (rows.length === 0) { show('暂无订单，无法导出'); return; }
    show('⏳ 正在生成汇总图，请稍候...');

    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-9999px;top:0;width:760px;background:#fff;padding:28px;';
    let html = `
        <div style="text-align:center;font-size:26px;font-weight:800;margin-bottom:6px;">已施工订单汇总单</div>
        <div style="text-align:right;font-size:13px;color:#666;margin-bottom:18px;">导出时间：${new Date().toLocaleString()}</div>`;

    rows.forEach((o) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemHtml = items.map((it) => `
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                <span>${esc(it.category || '')} ｜ 品牌：${esc(it.brand || '无')} ｜ 部位：${esc(it.part || '无')}</span>
                <span style="font-weight:700;color:#d97706;">￥${esc(fmtMoney(it.price))}（质保${esc(it.warranty || '无')}）</span>
            </div>`).join('');
        html += `
            <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-bottom:8px;">
                    <span>车牌：${esc(o.car_plate || '未填')} ｜ ${esc(o.car_model || '')}</span>
                    <span style="color:#3b82f6;">${esc(new Date(o.created_at).toLocaleString())}</span>
                </div>
                <div style="background:#f8fafc;border-radius:6px;padding:10px;margin-bottom:8px;">${itemHtml}</div>
                <div style="text-align:right;font-weight:700;color:#f59e0b;">小计：￥${esc(fmtMoney(o.total_amount))} 元</div>
            </div>`;
    });

    const grand = rows.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    html += `<div style="text-align:right;font-size:19px;font-weight:800;border-top:2px solid #333;padding-top:10px;">总计：<span style="color:#ef4444;">￥${esc(fmtMoney(grand))} 元</span></div>`;

    box.innerHTML = html;
    document.body.appendChild(box);

    html2canvas(box, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then((canvas) => {
        document.body.removeChild(box);
        $('alertMask').hidden = true;
        const a = document.createElement('a');
        a.download = '订单汇总_' + Date.now() + '.jpg';
        a.href = canvas.toDataURL('image/jpeg', 0.9);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        show('✅ 汇总图已生成');
    }).catch(() => {
        if (document.body.contains(box)) document.body.removeChild(box);
        $('alertMask').hidden = true;
        show('❌ 生成失败，请重试');
    });
}

// ===================== 统计 =====================
function renderStats() {
    if (state.orders.length === 0) {
        $('statGrid').innerHTML = '<div class="empty" style="grid-column:1/3">暂无数据，先去开一单</div>';
        $('catStats').innerHTML = '';
        $('dayStats').innerHTML = '';
        return;
    }
    const now = new Date();
    const inMonth = state.orders.filter((o) => {
        const t = new Date(o.created_at);
        return t.getMonth() === now.getMonth() && t.getFullYear() === now.getFullYear();
    });
    const today = state.orders.filter((o) => new Date(o.created_at).toDateString() === now.toDateString());
    const sum = (arr) => arr.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

    $('statGrid').innerHTML = `
        <div class="stat-box"><div class="stat-num">${inMonth.length}</div><div class="stat-label">本月单据（单）</div></div>
        <div class="stat-box"><div class="stat-num">￥${fmtMoney(sum(inMonth))}</div><div class="stat-label">本月营业额</div></div>
        <div class="stat-box"><div class="stat-num">${today.length}</div><div class="stat-label">今日单据（单）</div></div>
        <div class="stat-box"><div class="stat-num">￥${fmtMoney(sum(state.orders) / Math.max(1, state.orders.length) | 0)}</div><div class="stat-label">客单价（均）</div></div>`;

    // 大类分布（按金额）
    const byCat = {};
    state.orders.forEach((o) => {
        (Array.isArray(o.items) ? o.items : []).forEach((it) => {
            const k = it.category || '其他';
            byCat[k] = (byCat[k] || 0) + (Number(it.price) || 0);
        });
    });
    renderBars($('catStats'), byCat, true);

    // 近 7 天
    const byDay = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        byDay[`${d.getMonth() + 1}/${d.getDate()}`] = 0;
    }
    state.orders.forEach((o) => {
        const d = new Date(o.created_at);
        const k = `${d.getMonth() + 1}/${d.getDate()}`;
        if (k in byDay) byDay[k] += Number(o.total_amount) || 0;
    });
    renderBars($('dayStats'), byDay, true);
}

function renderBars(el, map, money) {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    el.innerHTML = entries.map(([k, v]) => `
        <div class="bar-row">
            <div>${esc(k)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((v / max) * 100)}%"></div></div>
            <div class="bar-val">${money ? '￥' : ''}${esc(fmtMoney(v))}</div>
        </div>`).join('');
}

// ===================== 事件绑定 =====================
function bindEvents() {
    // 登录
    document.querySelectorAll('.auth-tab').forEach((t) => { t.onclick = () => switchAuthTab(t.dataset.tab); });
    $('btnLogin').onclick = doLogin;
    $('btnRegister').onclick = doRegister;
    $('btnLogout').onclick = doLogout;
    $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('regPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });

    // 导航
    document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });

    // 开单
    $('btnAi').onclick = () => $('aiFile').click();
    $('aiFile').onchange = () => runAIScan();
    $('photoFile').onchange = (e) => onPhotoPicked(e.target);
    $('btnAddItem').onclick = addItem;
    $('btnSave').onclick = saveOrder;
    $('btnReset').onclick = async () => { if (await ask('清空当前填写的内容？')) clearForm(); };
    $('btnDraft').onclick = () => { saveDraft(); $('draftTip').hidden = false; $('draftTip').textContent = '草稿已保存到本机'; };
    ['carPlate', 'carModel', 'custPhone', 'workDate', 'remark'].forEach((id) => {
        $(id).addEventListener('input', saveDraft);
    });

    // 记录
    $('orderSearch').addEventListener('input', renderOrders);
    $('orderRange').addEventListener('change', renderOrders);
    $('btnReloadOrders').onclick = loadOrders;
    $('btnExport').onclick = exportSummary;

    // 详情
    $('btnCloseDetail').onclick = () => { $('detailMask').hidden = true; };
    $('btnBackToList').onclick = () => { $('detailMask').hidden = true; switchView('orders'); };
    $('btnDelOrder').onclick = deleteCurrentOrder;
    $('btnPrintText').onclick = () => {
        if (!state.currentOrder) return;
        $('printText').value = orderToText(state.currentOrder);
        $('printMask').hidden = false;
    };
    $('btnPrintDoc').onclick = () => window.print();
    $('btnClosePrint').onclick = () => { $('printMask').hidden = true; };
    $('btnCopyText').onclick = copyText;

    // 库存
    $('btnAddStock').onclick = addStockItem;
    $('btnSyncStock').onclick = async () => {
        await saveStock();
        await loadStock();
        show(state.stockCloud ? '✅ 库存已同步到云端' : '库存已保存到本机（云端 inventory 表未创建）');
    };

    // 弹层
    $('btnAlertOk').onclick = () => { $('alertMask').hidden = true; };
    $('alertMask').onclick = (e) => { if (e.target === $('alertMask')) $('alertMask').hidden = true; };
    $('btnConfirmYes').onclick = () => closeConfirm(true);
    $('btnConfirmNo').onclick = () => closeConfirm(false);
    $('confirmMask').onclick = (e) => { if (e.target === $('confirmMask')) closeConfirm(false); };
    $('lightbox').onclick = () => { $('lightbox').hidden = true; $('lightboxImg').src = ''; };
    ['detailMask', 'printMask'].forEach((id) => {
        $(id).onclick = (e) => { if (e.target === $(id)) $(id).hidden = true; };
    });
}

// ===================== 启动 =====================
async function boot() {
    bindEvents();
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (session) await enterApp(session);
        else $('authWrap').hidden = false;
    } catch (e) {
        $('authWrap').hidden = false;
    }
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') { $('appWrap').hidden = true; $('authWrap').hidden = false; }
    });
}

document.addEventListener('DOMContentLoaded', boot);
