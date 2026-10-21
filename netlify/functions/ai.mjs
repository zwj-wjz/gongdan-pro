/**
 * AI 车牌识别代理（Netlify Functions v2）
 *
 * 对外路径固定为 /api/ai，由下方 config.path 声明，
 * 前端 fetch('/api/ai') 无需改动。
 *
 * 部署前必须在 Netlify 站点 → Site configuration → Environment variables 配置：
 *   SILICON_API_KEY   硅基流动的 sk-... 密钥（必填）
 *   SILICON_MODEL     可选，默认 Qwen/Qwen3-VL-30B-A3B-Instruct
 *   SUPABASE_URL      可选
 *   SUPABASE_ANON_KEY 可选
 *
 * 请求头必须带 Authorization: Bearer <登录后的 access_token>，
 * 否则任何人都能拿这个接口刷你的 AI 额度。
 */

const SUPABASE_URL = env('SUPABASE_URL') || 'https://umatcwaodotqpttbuwew.supabase.co';
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY') || 'sb_publishable_ULquGaSNnY9G11RJcKLx_g_Xmcev2ig';
const SILICON_API_KEY = env('SILICON_API_KEY') || '';
const SILICON_MODEL = env('SILICON_MODEL') || 'Qwen/Qwen3-VL-30B-A3B-Instruct';
const SILICON_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions';

// base64 字符串长度上限（约 4MB 原始图片），防止有人拿超大 payload 打爆函数
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;

const PROMPT = '请识别图片里的车牌号和车型，用 JSON 格式输出，例如：{"车牌号": "川C·12345", "车型": "吉利几何"}。识别不到就填"未识别"。只返回 JSON，不要任何多余文字。';

/** Netlify 环境变量：优先 Netlify.env，本地/其他环境回退 process.env */
function env(name) {
    if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
        const v = Netlify.env.get(name);
        if (v !== undefined) return v;
    }
    return process.env[name];
}

function json(status, obj) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

/** 校验调用方是否是一个已登录的 Supabase 用户 */
async function verifyUser(req) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return null;

    try {
        const resp = await fetch(SUPABASE_URL + '/auth/v1/user', {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
        });
        if (!resp.ok) return null;
        const user = await resp.json();
        return user && user.id ? user : null;
    } catch (e) {
        console.error('verifyUser failed', e);
        return null;
    }
}

/** 把模型回复解析成 { plate, model }，兼容纯 JSON 和带文字说明两种情况 */
function parseReply(reply) {
    const text = String(reply || '').trim();
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    try {
        const obj = JSON.parse(cleaned);
        return {
            plate: String(obj['车牌号'] || obj.plate || '').trim(),
            model: String(obj['车型'] || obj.model || '').trim()
        };
    } catch (e) {
        const plate = (text.match(/车牌号[：:]\s*([^\s,，。"'}]+)/) || [])[1] || '';
        const model = (text.match(/车型[：:]\s*([^\s,，。"'}]+)/) || [])[1] || '';
        return { plate: plate.trim(), model: model.trim() };
    }
}

export default async (req) => {
    if (req.method !== 'POST') {
        return json(405, { error: '只支持 POST 请求' });
    }

    if (!SILICON_API_KEY) {
        console.error('SILICON_API_KEY is not set');
        return json(500, { error: '服务端未配置 AI 密钥，请联系管理员' });
    }

    const user = await verifyUser(req);
    if (!user) {
        return json(401, { error: '登录已失效，请重新登录' });
    }

    let body = null;
    try {
        body = await req.json();
    } catch (e) {
        body = null;
    }
    const image = body && body.image;

    if (typeof image !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
        return json(400, { error: '图片格式不支持，请重新拍摄' });
    }
    if (image.length > MAX_IMAGE_CHARS) {
        return json(413, { error: '图片过大，请重新拍摄' });
    }

    try {
        const resp = await fetch(SILICON_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + SILICON_API_KEY
            },
            body: JSON.stringify({
                model: SILICON_MODEL,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: PROMPT },
                        { type: 'image_url', image_url: { url: image } }
                    ]
                }],
                max_tokens: 150
            })
        });

        if (!resp.ok) {
            const detail = await resp.text();
            // 详细错误只进服务端日志，不回传给浏览器
            console.error('siliconflow failed', resp.status, detail.slice(0, 300));
            return json(502, {
                error: resp.status === 401 ? 'AI 服务密钥无效，请联系管理员' : 'AI 服务暂时不可用，请稍后重试'
            });
        }

        const data = await resp.json();
        const reply = (data && data.choices && data.choices[0] && data.choices[0].message)
            ? data.choices[0].message.content
            : '';
        const parsed = parseReply(reply);

        return json(200, {
            plate: parsed.plate,
            model: parsed.model,
            raw: String(reply || '').slice(0, 300)
        });
    } catch (e) {
        console.error('ai proxy error', e);
        return json(500, { error: '识别服务异常，请稍后重试' });
    }
};

// 自定义路由：浏览器请求 /api/ai 直接进这个函数
export const config = { path: '/api/ai' };
