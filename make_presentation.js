// ViziAI Investor Presentation
// Run: NODE_PATH="C:/Users/User/AppData/Roaming/npm/node_modules" node make_presentation.js

const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");

// Icon imports
const { FaVideo, FaChartBar, FaBell, FaShieldAlt, FaCloud, FaServer,
        FaCheckCircle, FaRocket, FaUsers, FaIndustry, FaBoxOpen,
        FaLock, FaDatabase, FaBolt, FaCogs, FaMapMarkerAlt } = require("react-icons/fa");
const { MdAnalytics, MdSecurity, MdSpeed } = require("react-icons/md");

// === COLORS ===
const C = {
  dark:    "0A2540",
  navy:    "0D3B6E",
  blue:    "1565C0",
  teal:    "028090",
  mint:    "02C39A",
  light:   "F4F9FC",
  white:   "FFFFFF",
  text:    "0A2540",
  muted:   "607D8B",
  card:    "FFFFFF",
  cardBg:  "EEF6FF",
  green:   "00897B",
  orange:  "F57C00",
  red:     "C62828",
};

async function iconBase64(IconComp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComp, { color, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function makeShadow() {
  return { type: "outer", color: "000000", blur: 8, offset: 2, angle: 45, opacity: 0.10 };
}

async function build() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.title = "ViziAI — Инвестиционная презентация";

  // ============================================================
  // SLIDE 1 — TITLE
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    // Big decorative circle top-right
    sl.addShape(pres.shapes.OVAL, {
      x: 7.5, y: -1.5, w: 5, h: 5,
      fill: { color: C.teal, transparency: 82 }, line: { color: C.teal, transparency: 82 }
    });
    sl.addShape(pres.shapes.OVAL, {
      x: 8.5, y: -0.5, w: 3, h: 3,
      fill: { color: C.mint, transparency: 88 }, line: { color: C.mint, transparency: 88 }
    });

    // LOGO text "ViziAI"
    sl.addText("Vizi", {
      x: 0.6, y: 0.5, w: 3, h: 0.9,
      fontSize: 52, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("AI", {
      x: 2.35, y: 0.5, w: 1.2, h: 0.9,
      fontSize: 52, bold: true, color: C.mint, fontFace: "Calibri", margin: 0
    });

    // Tag line
    sl.addText("Платформа видеоаналитики для ПВЗ и производств", {
      x: 0.6, y: 1.55, w: 8.5, h: 0.5,
      fontSize: 18, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    // Divider line
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 0.6, y: 2.25, w: 2.5, h: 0.04,
      fill: { color: C.mint }, line: { color: C.mint }
    });

    // Hero description
    sl.addText([
      { text: "Автоматический контроль персонала, зон и событий\nв реальном времени — через обычные IP-камеры.", options: { breakLine: false } }
    ], {
      x: 0.6, y: 2.5, w: 6.5, h: 1.0,
      fontSize: 15, color: "C8DFF0", fontFace: "Calibri", align: "left"
    });

    // Stats row
    const stats = [
      { val: "< 200 мс", lbl: "задержка\nанализа" },
      { val: "8+", lbl: "типов\nсобытий" },
      { val: "Cloud\n& On-Prem", lbl: "режимы\nразвёртки" },
      { val: "GPU", lbl: "YOLO v8\nBytesTrack" },
    ];
    stats.forEach((s, i) => {
      const x = 0.6 + i * 2.3;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 3.75, w: 2.1, h: 1.45,
        fill: { color: C.navy, transparency: 30 },
        line: { color: C.teal, transparency: 60 },
        rectRadius: 0.1
      });
      sl.addText(s.val, {
        x: x + 0.05, y: 3.85, w: 2.0, h: 0.6,
        fontSize: 19, bold: true, color: C.mint, fontFace: "Calibri", align: "center", margin: 0
      });
      sl.addText(s.lbl, {
        x: x + 0.05, y: 4.45, w: 2.0, h: 0.65,
        fontSize: 10, color: "A0C4E2", fontFace: "Calibri", align: "center", margin: 0
      });
    });

    // Bottom note
    sl.addText("2026 · Конфиденциально · Для инвесторов", {
      x: 0.6, y: 5.25, w: 9, h: 0.25,
      fontSize: 9, color: "4A6880", fontFace: "Calibri", align: "left", margin: 0
    });
    sl.addNotes("Представьтесь. ViziAI — платформа, которая превращает обычные IP-камеры в интеллектуальных наблюдателей без покупки дорогого оборудования.");
  }

  // ============================================================
  // SLIDE 2 — PROBLEM
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.light };

    sl.addText("Проблема", {
      x: 0.5, y: 0.25, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.text, fontFace: "Calibri", margin: 0
    });
    sl.addText("Что происходит на ПВЗ и производстве без видеоаналитики", {
      x: 0.5, y: 0.85, w: 9, h: 0.35,
      fontSize: 14, color: C.muted, fontFace: "Calibri", margin: 0
    });

    const problems = [
      { icon: "👁", title: "Слепые зоны", desc: "Менеджер видит записи — но только после инцидента. Нарушения замечают спустя часы или не замечают вовсе." },
      { icon: "📋", title: "Ручной контроль", desc: "Подсчёт посетителей, проверка зон, контроль СИЗ — всё делается руками, занимает время и даёт ошибки." },
      { icon: "💸", title: "Потери без причины", desc: "Очереди, непорядок на полках, пропущенные нарушения — прямые потери, которые никто не считает." },
      { icon: "⚠", title: "Реакция постфактум", desc: "Нет оповещений в реальном времени. О проблеме узнают только когда уже поздно что-то исправить." },
      { icon: "🔒", title: "Нет доказательной базы", desc: "При спорах и проверках нет структурированных данных, только сырое видео — долго и неудобно." },
      { icon: "📊", title: "Нет аналитики", desc: "Данные о трафике, загрузке персонала, времени обслуживания не накапливаются и не анализируются." },
    ];

    problems.forEach((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 0.4 + col * 3.1;
      const y = 1.4 + row * 1.85;

      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y, w: 2.9, h: 1.65,
        fill: { color: C.white }, line: { color: "D8E8F5" },
        rectRadius: 0.12,
        shadow: makeShadow()
      });
      sl.addText(p.icon + "  " + p.title, {
        x: x + 0.15, y: y + 0.12, w: 2.65, h: 0.38,
        fontSize: 13, bold: true, color: C.navy, fontFace: "Calibri", margin: 0
      });
      sl.addText(p.desc, {
        x: x + 0.15, y: y + 0.52, w: 2.65, h: 1.05,
        fontSize: 10, color: C.muted, fontFace: "Calibri", align: "left", margin: 0
      });
    });

    sl.addNotes("Рынок ПВЗ и лёгких производств в России: тысячи точек, ни одна из которых не имеет доступной интеллектуальной аналитики. CCTV есть везде — пользы от него ноль.");
  }

  // ============================================================
  // SLIDE 3 — SOLUTION (pipeline)
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    sl.addText("Решение", {
      x: 0.5, y: 0.2, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("ViziAI превращает существующие камеры в умную систему мониторинга", {
      x: 0.5, y: 0.78, w: 9.2, h: 0.32,
      fontSize: 13, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    // Pipeline boxes
    const steps = [
      { label: "IP-камеры\nRTSP / SRT", color: "1565C0", icon: "📷" },
      { label: "Ingest\nбуфер кадров", color: "1976D2", icon: "⚡" },
      { label: "YOLO v8\n+ ByteTrack", color: C.teal, icon: "🧠" },
      { label: "Zone\nEngine", color: "00838F", icon: "📍" },
      { label: "Events\n& Alerts", color: "00897B", icon: "🔔" },
      { label: "Dashboard\n& API", color: "2E7D32", icon: "📊" },
    ];

    const boxW = 1.38, boxH = 1.0, startX = 0.35, y = 1.55;
    const gap = (10 - startX * 2 - boxW * steps.length) / (steps.length - 1);

    steps.forEach((s, i) => {
      const x = startX + i * (boxW + gap);
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y, w: boxW, h: boxH,
        fill: { color: s.color }, line: { color: s.color },
        rectRadius: 0.12
      });
      sl.addText(s.icon, {
        x: x + 0.05, y: y + 0.05, w: boxW - 0.1, h: 0.38,
        fontSize: 20, align: "center", margin: 0, color: C.white
      });
      sl.addText(s.label, {
        x: x + 0.05, y: y + 0.45, w: boxW - 0.1, h: 0.5,
        fontSize: 9.5, align: "center", color: C.white, fontFace: "Calibri", margin: 0
      });

      // Arrow
      if (i < steps.length - 1) {
        const ax = x + boxW + 0.05;
        sl.addShape(pres.shapes.RECTANGLE, {
          x: ax, y: y + boxH / 2 - 0.02, w: gap - 0.1, h: 0.04,
          fill: { color: C.mint }, line: { color: C.mint }
        });
        // arrowhead triangle
        sl.addShape(pres.shapes.RECTANGLE, {
          x: ax + gap - 0.15, y: y + boxH / 2 - 0.08, w: 0.12, h: 0.16,
          fill: { color: C.mint }, line: { color: C.mint }
        });
      }
    });

    // Redis streams label
    sl.addText("Redis Streams — шина сообщений между всеми сервисами", {
      x: 0.5, y: 2.75, w: 9, h: 0.3,
      fontSize: 11, color: C.mint, fontFace: "Calibri", align: "center", italic: true, margin: 0
    });

    // Output cards row
    const outputs = [
      { t: "PostgreSQL\n+ TimescaleDB", d: "Хранение событий\nгипертаблицы" },
      { t: "MinIO S3", d: "Клипы и\nскриншоты" },
      { t: "Telegram /\nWebhook", d: "Алерты в\nреальном времени" },
      { t: "WebSocket\nDashboard", d: "Live-события\nв браузере" },
    ];
    outputs.forEach((o, i) => {
      const x = 0.65 + i * 2.25;
      const y2 = 3.2;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: y2, w: 2.05, h: 1.15,
        fill: { color: C.navy, transparency: 20 },
        line: { color: C.teal, transparency: 50 },
        rectRadius: 0.1
      });
      sl.addText(o.t, {
        x: x + 0.05, y: y2 + 0.08, w: 1.95, h: 0.45,
        fontSize: 11, bold: true, color: C.mint, fontFace: "Calibri", align: "center", margin: 0
      });
      sl.addText(o.d, {
        x: x + 0.05, y: y2 + 0.55, w: 1.95, h: 0.55,
        fontSize: 9.5, color: "A0C4E2", fontFace: "Calibri", align: "center", margin: 0
      });
    });

    sl.addNotes("Весь пайплайн работает асинхронно через Redis Streams. Падение одной камеры не роняет систему — переподключение с экспоненциальным бэкоффом.");
  }

  // ============================================================
  // SLIDE 4 — WHAT IS READY (MVP status)
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.light };

    sl.addText("Что уже готово", {
      x: 0.5, y: 0.22, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.text, fontFace: "Calibri", margin: 0
    });
    sl.addText("Статус разработки MVP по компонентам", {
      x: 0.5, y: 0.8, w: 9, h: 0.32,
      fontSize: 13, color: C.muted, fontFace: "Calibri", margin: 0
    });

    // Left column - completed
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.4, y: 1.25, w: 4.4, h: 3.85,
      fill: { color: "E8F5E9" }, line: { color: "A5D6A7" }, rectRadius: 0.14,
      shadow: makeShadow()
    });
    sl.addText("✅  Готово", {
      x: 0.6, y: 1.35, w: 4.0, h: 0.38,
      fontSize: 14, bold: true, color: "2E7D32", fontFace: "Calibri", margin: 0
    });

    const done = [
      "Инфраструктура: PostgreSQL + TimescaleDB, Redis, MinIO, go2rtc",
      "Analyzer: инжест RTSP/SRT, YOLO v8 детекция, ByteTrack трекинг",
      "Redis Streams: raw_frames → track_events → events",
      "Backend API (Fastify 5 + TypeScript): REST + WebSocket",
      "Drizzle ORM: схемы + миграции всех таблиц",
      "JWT-аутентификация + мультитенантность (tenant_id)",
      "Фронтенд: Next.js 15, live-события через WebSocket",
      "Docker Compose: dev и prod конфиги",
    ];
    done.forEach((d, i) => {
      sl.addText([{ text: d, options: { bullet: true } }], {
        x: 0.6, y: 1.82 + i * 0.36, w: 3.95, h: 0.35,
        fontSize: 10, color: C.text, fontFace: "Calibri", margin: 0
      });
    });

    // Right column - in progress / roadmap
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 5.1, y: 1.25, w: 4.4, h: 3.85,
      fill: { color: "FFF8E1" }, line: { color: "FFD54F" }, rectRadius: 0.14,
      shadow: makeShadow()
    });
    sl.addText("🔧  В разработке / MVP шаги 5–8", {
      x: 5.3, y: 1.35, w: 4.0, h: 0.38,
      fontSize: 14, bold: true, color: "E65100", fontFace: "Calibri", margin: 0
    });

    const wip = [
      "Zone Engine: геофенсинг, zone_entry / zone_exit события",
      "Clips Worker: BullMQ + ffmpeg нарезка клипов по запросу",
      "Alerts Worker: Telegram-бот + Email + Webhook",
      "Плагин queue_alert: детектирование длинных очередей",
      "Плагин repack_event: фиксация перепакования на ПВЗ",
      "Плагин shelf_violation: мониторинг полок",
      "Редактор зон: Canvas API поверх видео",
      "Расписания активности зон и алерт-правил",
    ];
    wip.forEach((w, i) => {
      sl.addText([{ text: w, options: { bullet: true } }], {
        x: 5.3, y: 1.82 + i * 0.36, w: 3.95, h: 0.35,
        fontSize: 10, color: C.text, fontFace: "Calibri", margin: 0
      });
    });

    sl.addNotes("Фундамент полностью готов. Сейчас ведётся разработка бизнес-логики: зоны, клипы, алерты, плагины.");
  }

  // ============================================================
  // SLIDE 5 — KEY FEATURES
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    sl.addText("Ключевые функции", {
      x: 0.5, y: 0.2, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("Что получает клиент из коробки", {
      x: 0.5, y: 0.78, w: 9, h: 0.32,
      fontSize: 13, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    const features = [
      {
        icon: "🎥", title: "Live-мониторинг",
        pts: ["WebRTC через go2rtc — нулевая задержка", "Одновременно все камеры на экране", "720p/1080p без потоков через облако"]
      },
      {
        icon: "📍", title: "Зоны и геофенсинг",
        pts: ["Произвольные полигоны прямо на видео", "Вход / выход / время нахождения в зоне", "Расписание активности"]
      },
      {
        icon: "🔔", title: "Алерты в реальном времени",
        pts: ["Telegram, Email, Webhook", "Настраиваемые правила и кулдаун", "Приоритеты: info / warn / critical"]
      },
      {
        icon: "🧠", title: "AI-плагины",
        pts: ["Очереди: queue_alert при > N человек", "Перепакование: repack_event на ПВЗ", "Нарушения СИЗ: ppe_violation"]
      },
      {
        icon: "📼", title: "Видеоархив и клипы",
        pts: ["Автонарезка клипа при событии", "MinIO S3: хранение без лимита", "Поиск по событиям, скриншоты"]
      },
      {
        icon: "📊", title: "Аналитика и отчёты",
        pts: ["TimescaleDB: миллиарды событий быстро", "Тренды по зонам, камерам, тенантам", "Экспорт для руководства"]
      },
    ];

    features.forEach((f, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 0.4 + col * 3.15;
      const y = 1.3 + row * 1.95;

      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y, w: 2.95, h: 1.8,
        fill: { color: C.navy, transparency: 15 },
        line: { color: C.teal, transparency: 55 },
        rectRadius: 0.12,
        shadow: makeShadow()
      });
      sl.addText(f.icon + "  " + f.title, {
        x: x + 0.12, y: y + 0.1, w: 2.7, h: 0.42,
        fontSize: 13, bold: true, color: C.mint, fontFace: "Calibri", margin: 0
      });
      f.pts.forEach((pt, pi) => {
        sl.addText([{ text: pt, options: { bullet: true } }], {
          x: x + 0.12, y: y + 0.55 + pi * 0.38, w: 2.7, h: 0.36,
          fontSize: 10, color: "C8DFF0", fontFace: "Calibri", margin: 0
        });
      });
    });

    sl.addNotes("Плагинная архитектура позволяет добавлять новые виды анализа без изменения ядра. Один тенант — один набор активных плагинов.");
  }

  // ============================================================
  // SLIDE 6 — TECH STACK
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.light };

    sl.addText("Технологический стек", {
      x: 0.5, y: 0.22, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.text, fontFace: "Calibri", margin: 0
    });
    sl.addText("Надёжные компоненты без vendor lock-in", {
      x: 0.5, y: 0.8, w: 9, h: 0.32,
      fontSize: 13, color: C.muted, fontFace: "Calibri", margin: 0
    });

    const cols = [
      {
        title: "AI / Аналитика",
        color: "1565C0",
        items: ["Python 3.12 + mypy strict", "YOLOv8 (Ultralytics)", "ByteTrack (supervision)", "OpenCV — обработка кадров", "Redis Streams consumer", "GPU CUDA, TensorRT — план"]
      },
      {
        title: "Backend API",
        color: C.teal,
        items: ["Node.js 22 LTS + TypeScript strict", "Fastify 5 + WebSocket", "Drizzle ORM (типобезопасно)", "Zod — валидация запросов", "BullMQ (Redis) — очереди", "JWT + мультитенантность"]
      },
      {
        title: "Frontend",
        color: "00897B",
        items: ["Next.js 15 (App Router)", "shadcn/ui + TailwindCSS", "TanStack Query — кеш API", "Zustand — global state", "WebRTC via go2rtc", "Canvas API — редактор зон"]
      },
      {
        title: "Инфраструктура",
        color: "6A1B9A",
        items: ["PostgreSQL 16 + TimescaleDB", "Redis 7 (Streams + BullMQ)", "MinIO (S3-совместимый)", "go2rtc — RTSP→WebRTC", "WireGuard VPN туннели", "Docker + Compose"]
      },
    ];

    cols.forEach((c, i) => {
      const x = 0.35 + i * 2.35;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 1.22, w: 2.2, h: 3.95,
        fill: { color: C.white }, line: { color: "D0E4F5" }, rectRadius: 0.14,
        shadow: makeShadow()
      });
      // Header bar
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 1.22, w: 2.2, h: 0.5,
        fill: { color: c.color }, line: { color: c.color }, rectRadius: 0.14
      });
      sl.addShape(pres.shapes.RECTANGLE, {
        x, y: 1.5, w: 2.2, h: 0.22,
        fill: { color: c.color }, line: { color: c.color }
      });
      sl.addText(c.title, {
        x: x + 0.1, y: 1.25, w: 2.05, h: 0.44,
        fontSize: 12, bold: true, color: C.white, fontFace: "Calibri", align: "center", margin: 0
      });
      c.items.forEach((item, j) => {
        sl.addText([{ text: item, options: { bullet: true } }], {
          x: x + 0.1, y: 1.82 + j * 0.52, w: 2.05, h: 0.5,
          fontSize: 10, color: C.text, fontFace: "Calibri", margin: 0
        });
      });
    });

    sl.addNotes("Весь стек — open source, без привязки к вендору. Можно развернуть на любом Linux-сервере от домашнего ПК до стойки ДЦ.");
  }

  // ============================================================
  // SLIDE 7 — TARGET MARKET
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    sl.addText("Целевой рынок", {
      x: 0.5, y: 0.2, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("Россия: нишевые вертикали с высоким спросом и низким насыщением", {
      x: 0.5, y: 0.78, w: 9, h: 0.32,
      fontSize: 13, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    // Big stat
    const bigStats = [
      { n: "50 000+", l: "ПВЗ\nв России (2025)" },
      { n: "200 000+", l: "малых\nпроизводств" },
      { n: "< 3%", l: "используют\nвидеоаналитику" },
    ];
    bigStats.forEach((s, i) => {
      const x = 0.5 + i * 3.1;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 1.3, w: 2.8, h: 1.3,
        fill: { color: C.teal, transparency: 75 },
        line: { color: C.mint, transparency: 60 },
        rectRadius: 0.14
      });
      sl.addText(s.n, {
        x: x + 0.05, y: 1.38, w: 2.7, h: 0.6,
        fontSize: 28, bold: true, color: C.mint, fontFace: "Calibri", align: "center", margin: 0
      });
      sl.addText(s.l, {
        x: x + 0.05, y: 1.98, w: 2.7, h: 0.5,
        fontSize: 11, color: "A0C4E2", fontFace: "Calibri", align: "center", margin: 0
      });
    });

    // Segments
    const segs = [
      {
        icon: "📦", title: "ПВЗ (Wildberries, OZON, СДЭ К…)",
        pts: ["Контроль перепакования и повреждений", "Учёт посетителей и времени обслуживания", "Мониторинг зон выдачи и примерочных"]
      },
      {
        icon: "🏭", title: "Лёгкое производство",
        pts: ["Контроль СИЗ (каски, жилеты, очки)", "Мониторинг рабочих зон и запрещённых зон", "Очереди на складе / конвейере"]
      },
      {
        icon: "🏪", title: "Ритейл и склады",
        pts: ["Детекция пустых полок", "Контроль персонала и посетителей", "Видеоаудит выкладки товаров"]
      },
    ];

    segs.forEach((s, i) => {
      const x = 0.4 + i * 3.15;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 2.9, w: 2.95, h: 2.3,
        fill: { color: C.navy, transparency: 20 },
        line: { color: C.teal, transparency: 55 },
        rectRadius: 0.12
      });
      sl.addText(s.icon + "  " + s.title, {
        x: x + 0.12, y: 2.98, w: 2.72, h: 0.42,
        fontSize: 12, bold: true, color: C.mint, fontFace: "Calibri", margin: 0
      });
      s.pts.forEach((pt, pi) => {
        sl.addText([{ text: pt, options: { bullet: true } }], {
          x: x + 0.12, y: 3.45 + pi * 0.55, w: 2.72, h: 0.52,
          fontSize: 10.5, color: "C8DFF0", fontFace: "Calibri", margin: 0
        });
      });
    });

    sl.addNotes("Начинаем с ПВЗ — самый понятный pain point (перепакование, вскрытие посылок). Потом производство через партнёров.");
  }

  // ============================================================
  // SLIDE 8 — DEPLOYMENT MODES
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.light };

    sl.addText("Гибкое развёртывание", {
      x: 0.5, y: 0.22, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.text, fontFace: "Calibri", margin: 0
    });
    sl.addText("Один код — два режима. Переключение одной переменной DEPLOYMENT_MODE", {
      x: 0.5, y: 0.8, w: 9.2, h: 0.32,
      fontSize: 13, color: C.muted, fontFace: "Calibri", margin: 0
    });

    // Cloud mode card
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.4, y: 1.25, w: 4.35, h: 3.9,
      fill: { color: "E3F2FD" }, line: { color: "90CAF9" }, rectRadius: 0.14,
      shadow: makeShadow()
    });
    sl.addText("☁  Cloud Mode", {
      x: 0.6, y: 1.35, w: 3.95, h: 0.48,
      fontSize: 16, bold: true, color: "1565C0", fontFace: "Calibri", margin: 0
    });
    sl.addText("Для ПВЗ-сетей и малого бизнеса", {
      x: 0.6, y: 1.82, w: 3.95, h: 0.32,
      fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true, margin: 0
    });

    const cloudPts = [
      "Мультитенант на нашем сервере",
      "Камеры → WireGuard VPN → наш ДЦ",
      "SaaS подписка, мгновенный старт",
      "Обновления без участия клиента",
      "Масштабирование: домашний ПК → стойка ДЦ",
      "Единый дашборд для всей сети ПВЗ",
    ];
    cloudPts.forEach((p, i) => {
      sl.addText([{ text: p, options: { bullet: true } }], {
        x: 0.6, y: 2.22 + i * 0.42, w: 3.95, h: 0.4,
        fontSize: 11, color: C.text, fontFace: "Calibri", margin: 0
      });
    });

    // On-premise card
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 5.15, y: 1.25, w: 4.35, h: 3.9,
      fill: { color: "F3E5F5" }, line: { color: "CE93D8" }, rectRadius: 0.14,
      shadow: makeShadow()
    });
    sl.addText("🏭  On-Premise Mode", {
      x: 5.35, y: 1.35, w: 3.95, h: 0.48,
      fontSize: 16, bold: true, color: "6A1B9A", fontFace: "Calibri", margin: 0
    });
    sl.addText("Для заводов и изолированных сетей", {
      x: 5.35, y: 1.82, w: 3.95, h: 0.32,
      fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true, margin: 0
    });

    const onPremPts = [
      "Все сервисы разворачиваются локально",
      "Нет исходящего трафика — 100% изоляция",
      "Одноразовая лицензия + техподдержка",
      "Работа без интернета (air-gap)",
      "Подходит для режимных объектов (ISO 27001)",
      "Видео не покидает периметр предприятия",
    ];
    onPremPts.forEach((p, i) => {
      sl.addText([{ text: p, options: { bullet: true } }], {
        x: 5.35, y: 2.22 + i * 0.42, w: 3.95, h: 0.4,
        fontSize: 11, color: C.text, fontFace: "Calibri", margin: 0
      });
    });

    sl.addNotes("Переключение DEPLOYMENT_MODE=cloud|on-premise. Код один и тот же, конфигурация разная. Это принципиальное архитектурное решение с первого дня.");
  }

  // ============================================================
  // SLIDE 9 — ROADMAP
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    sl.addText("Дорожная карта", {
      x: 0.5, y: 0.2, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("От MVP к полноценной платформе", {
      x: 0.5, y: 0.78, w: 9, h: 0.32,
      fontSize: 13, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    const phases = [
      {
        phase: "MVP",
        period: "Сейчас",
        color: C.mint,
        bgColor: "003320",
        items: ["Инфраструктура готова", "Детекция + трекинг работают", "API + WebSocket + фронтенд", "Zone Engine в разработке"]
      },
      {
        phase: "v1.0",
        period: "Q3 2026",
        color: "FFD54F",
        bgColor: "2D2000",
        items: ["Зоны + все базовые события", "Clips + Alerts workers", "Плагины: queue, repack", "Первый пилот у клиента"]
      },
      {
        phase: "v1.5",
        period: "Q4 2026",
        color: "FF8A65",
        bgColor: "2D1200",
        items: ["Плагин СИЗ (ppe_violation)", "Face ID плагин (опционально)", "Shelf violation плагин", "Мобильное приложение"]
      },
      {
        phase: "v2.0",
        period: "Q1 2027",
        color: "CE93D8",
        bgColor: "1A0030",
        items: ["TensorRT-ускорение", "Авто-отчёты по расписанию", "API для интеграций (1С и др)", "Маркетплейс плагинов"]
      },
    ];

    phases.forEach((p, i) => {
      const x = 0.4 + i * 2.4;
      // Connector line
      if (i < phases.length - 1) {
        sl.addShape(pres.shapes.RECTANGLE, {
          x: x + 2.1, y: 1.52, w: 0.3, h: 0.06,
          fill: { color: "334455" }, line: { color: "334455" }
        });
      }
      // Circle
      sl.addShape(pres.shapes.OVAL, {
        x: x + 0.65, y: 1.25, w: 0.6, h: 0.6,
        fill: { color: p.color }, line: { color: p.color }
      });
      sl.addText(i + 1 + "", {
        x: x + 0.65, y: 1.27, w: 0.6, h: 0.55,
        fontSize: 14, bold: true, color: C.dark, align: "center", fontFace: "Calibri", margin: 0
      });

      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 2.0, w: 2.2, h: 3.2,
        fill: { color: p.bgColor }, line: { color: p.color, transparency: 60 }, rectRadius: 0.14
      });
      sl.addText(p.phase, {
        x: x + 0.1, y: 2.08, w: 2.05, h: 0.42,
        fontSize: 15, bold: true, color: p.color, fontFace: "Calibri", align: "center", margin: 0
      });
      sl.addText(p.period, {
        x: x + 0.1, y: 2.5, w: 2.05, h: 0.3,
        fontSize: 10, color: "778899", fontFace: "Calibri", align: "center", italic: true, margin: 0
      });
      p.items.forEach((item, j) => {
        sl.addText([{ text: item, options: { bullet: true } }], {
          x: x + 0.12, y: 2.88 + j * 0.55, w: 2.0, h: 0.52,
          fontSize: 10, color: "C8DFF0", fontFace: "Calibri", margin: 0
        });
      });
    });

    sl.addNotes("Приоритет — первый пилот в реальных условиях. После v1.0 открываем API для партнёрских интеграций.");
  }

  // ============================================================
  // SLIDE 10 — BUSINESS MODEL
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.light };

    sl.addText("Бизнес-модель", {
      x: 0.5, y: 0.22, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.text, fontFace: "Calibri", margin: 0
    });
    sl.addText("Три потока выручки с разными профилями риска", {
      x: 0.5, y: 0.8, w: 9, h: 0.32,
      fontSize: 13, color: C.muted, fontFace: "Calibri", margin: 0
    });

    const streams = [
      {
        n: "01", title: "SaaS Подписка\n(Cloud)", color: "1565C0", bgColor: "E3F2FD",
        price: "от 2 900 ₽/мес\nза точку",
        pts: ["Безлимит по событиям", "Включает алерты + клипы", "Тарифы: Base / Pro / Enterprise", "Скидка от 5+ точек в сети"]
      },
      {
        n: "02", title: "On-Premise\nЛицензия", color: "6A1B9A", bgColor: "F3E5F5",
        price: "от 150 000 ₽\nза объект",
        pts: ["Бессрочная лицензия", "Техподдержка — годовой контракт", "Внедрение и настройка под ключ", "Апдейты — по соглашению"]
      },
      {
        n: "03", title: "Плагины\n& Add-ons", color: "00897B", bgColor: "E0F2F1",
        price: "500–1500 ₽/мес\nза плагин",
        pts: ["Face ID, СИЗ, shelf — как опции", "Маркетплейс плагинов (v2.0)", "Партнёрские плагины (revenue share)", "Custom разработка под заказ"]
      },
    ];

    streams.forEach((s, i) => {
      const x = 0.4 + i * 3.15;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: 1.22, w: 2.95, h: 4.0,
        fill: { color: s.bgColor }, line: { color: s.color, transparency: 40 }, rectRadius: 0.14,
        shadow: makeShadow()
      });
      sl.addText(s.n, {
        x: x + 0.15, y: 1.3, w: 0.5, h: 0.42,
        fontSize: 22, bold: true, color: s.color, fontFace: "Calibri", margin: 0
      });
      sl.addText(s.title, {
        x: x + 0.65, y: 1.3, w: 2.1, h: 0.46,
        fontSize: 13, bold: true, color: s.color, fontFace: "Calibri", margin: 0
      });
      sl.addShape(pres.shapes.RECTANGLE, {
        x: x + 0.15, y: 1.8, w: 2.65, h: 0.02,
        fill: { color: s.color, transparency: 60 }, line: { color: s.color, transparency: 60 }
      });
      sl.addText(s.price, {
        x: x + 0.15, y: 1.88, w: 2.65, h: 0.6,
        fontSize: 14, bold: true, color: s.color, fontFace: "Calibri", align: "center", margin: 0
      });
      s.pts.forEach((pt, j) => {
        sl.addText([{ text: pt, options: { bullet: true } }], {
          x: x + 0.15, y: 2.58 + j * 0.55, w: 2.7, h: 0.52,
          fontSize: 10.5, color: C.text, fontFace: "Calibri", margin: 0
        });
      });
    });

    sl.addNotes("Unit economics: при 100 ПВЗ на Base-тарифе — 290 000 ₽/мес MRR. Цель первого года — 50 активных точек.");
  }

  // ============================================================
  // SLIDE 11 — NEW FEATURES (future)
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    sl.addText("Потенциал расширения", {
      x: 0.5, y: 0.2, w: 9, h: 0.55,
      fontSize: 30, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("Функции, которые можно добавить при дополнительном финансировании", {
      x: 0.5, y: 0.78, w: 9.2, h: 0.32,
      fontSize: 13, color: "A0C4E2", fontFace: "Calibri", margin: 0
    });

    const extras = [
      { icon: "🎭", t: "Face ID", d: "Идентификация лиц из whitelist/blacklist. Контроль персонала, вход по лицу, неизвестные лица." },
      { icon: "🦺", t: "СИЗ (PPE)", d: "Детекция каски, жилета, очков, перчаток. Автоалерт при нарушении на производстве." },
      { icon: "🚗", t: "LPR Номера", d: "Распознавание номерных знаков. Контроль въезда, автоматические ворота, черные списки." },
      { icon: "📱", t: "Мобильное приложение", d: "iOS/Android: push-алерты, live-видео, быстрый просмотр событий по дороге." },
      { icon: "🔌", t: "Интеграции", d: "1С, Bitrix24, СБИС, OpenAPI. Передача событий в ERP и CRM клиента." },
      { icon: "🤖", t: "Авто-отчёты AI", d: "LLM-генерация ежедневных сводок, аномалий и рекомендаций для руководства." },
      { icon: "🌡", t: "Тепловые карты", d: "Накопленная визуализация движения: горячие зоны, слепые зоны, пути клиентов." },
      { icon: "📡", t: "Edge AI", d: "Inference прямо на камере (Jetson Nano/Hailo). Снижение трафика до нуля." },
    ];

    extras.forEach((e, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 0.35 + col * 2.4;
      const y = 1.3 + row * 1.95;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y, w: 2.22, h: 1.75,
        fill: { color: C.navy, transparency: 20 },
        line: { color: C.teal, transparency: 60 }, rectRadius: 0.12
      });
      sl.addText(e.icon + "  " + e.t, {
        x: x + 0.1, y: y + 0.1, w: 2.05, h: 0.4,
        fontSize: 12, bold: true, color: C.mint, fontFace: "Calibri", margin: 0
      });
      sl.addText(e.d, {
        x: x + 0.1, y: y + 0.55, w: 2.05, h: 1.1,
        fontSize: 9.5, color: "A8C8E0", fontFace: "Calibri", align: "left", margin: 0
      });
    });

    sl.addNotes("Каждая из этих функций — отдельный плагин или интеграционный модуль. Плагинная архитектура позволяет добавлять их не затрагивая ядро.");
  }

  // ============================================================
  // SLIDE 12 — CLOSING / CTA
  // ============================================================
  {
    const sl = pres.addSlide();
    sl.background = { color: C.dark };

    // Decorative circles
    sl.addShape(pres.shapes.OVAL, {
      x: 7.2, y: 1.5, w: 4.5, h: 4.5,
      fill: { color: C.teal, transparency: 88 }, line: { color: C.teal, transparency: 88 }
    });
    sl.addShape(pres.shapes.OVAL, {
      x: -1.5, y: -1, w: 4, h: 4,
      fill: { color: C.mint, transparency: 90 }, line: { color: C.mint, transparency: 90 }
    });

    sl.addText("Vizi", {
      x: 0.6, y: 0.6, w: 3, h: 0.85,
      fontSize: 48, bold: true, color: C.white, fontFace: "Calibri", margin: 0
    });
    sl.addText("AI", {
      x: 2.25, y: 0.6, w: 1.1, h: 0.85,
      fontSize: 48, bold: true, color: C.mint, fontFace: "Calibri", margin: 0
    });

    sl.addText("Превращаем камеры в интеллект", {
      x: 0.6, y: 1.55, w: 7, h: 0.5,
      fontSize: 20, color: "A0C4E2", fontFace: "Calibri", italic: true, margin: 0
    });

    // Summary points
    const summary = [
      "✅  Архитектура и инфраструктура полностью готовы",
      "✅  AI-детекция и трекинг работают на реальном железе",
      "✅  Гибкое развёртывание: SaaS или полная изоляция",
      "✅  Плагинная система — масштабируемо без переписывания",
      "🎯  Ищем: инвестиции на пилот, первых клиентов, партнёров",
    ];
    summary.forEach((s, i) => {
      sl.addText(s, {
        x: 0.6, y: 2.3 + i * 0.52, w: 7.8, h: 0.46,
        fontSize: 13, color: i < 4 ? "C8DFF0" : C.mint, fontFace: "Calibri",
        bold: i === 4, margin: 0
      });
    });

    // Contact box
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.6, y: 5.0, w: 4.5, h: 0.45,
      fill: { color: C.teal, transparency: 80 }, line: { color: C.teal, transparency: 50 }, rectRadius: 0.08
    });
    sl.addText("levrurisimo@gmail.com  ·  Telegram: @viziAI", {
      x: 0.7, y: 5.02, w: 4.3, h: 0.4,
      fontSize: 11, color: C.mint, fontFace: "Calibri", margin: 0
    });

    sl.addNotes("Закончите призывом к действию: предложите пилот на одной из их точек — бесплатно на 30 дней. Нам нужен реальный фидбэк, им — бесплатный инструмент.");
  }

  await pres.writeFile({ fileName: "ViziAI_Investor_Deck.pptx" });
  console.log("Done: ViziAI_Investor_Deck.pptx");
}

build().catch(e => { console.error(e); process.exit(1); });
