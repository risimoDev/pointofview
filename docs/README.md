# Документация BZK-VIZIAI

Единая точка входа. Вся документация проекта живёт здесь; в корне репозитория остаются только `CLAUDE.md` (инструкции для разработки) и `PLAN.md` (текущее состояние и приоритеты — читать в начале сессии).

```
docs/
├── commercial/   продажи, право, работа с клиентом
├── product/      функции, отраслевые направления, развитие ИИ
├── architecture/ инженерная документация (26 документов + решения)
├── operations/   развёртывание, эксплуатация, железо
└── archive/      устаревшее и исходники презентаций
```

---

## commercial — с чем идти к клиенту

| Документ | Кому | О чём |
|---|---|---|
| [00_LEGAL.md](commercial/00_LEGAL.md) | владельцу | Юридическое оформление: форма организации, права на код, лицензии открытого кода, 152-ФЗ, границы ответственности, комплект договоров |
| [01_LICENSE_REMEDIATION.md](commercial/01_LICENSE_REMEDIATION.md) | владельцу | Аудит всех компонентов по лицензиям и варианты замены для каждого проблемного. Документ для принятия решения |
| [10_CLIENT_OFFER.md](commercial/10_CLIENT_OFFER.md) | клиенту | Коммерческое предложение для предприятия. Разделы 3.1–3.3 — источник правды о зрелости функций |
| [20_SALES_PLAYBOOK.md](commercial/20_SALES_PLAYBOOK.md) | продавцу | Портрет клиента, скрипты, демонстрация, возражения, красная зона запретов, анкета объекта |
| [word/](commercial/word/) | — | Те же три документа в формате Word для печати: `01_Юридическое_оформление.docx`, `02_Коммерческое_предложение.docx`, `03_Руководство_продавца.docx` |

Word-версии собираются из markdown, править нужно markdown:

```
npm install docx
node scripts/docs-export/md2docx.js scripts/docs-export/jobs.json
```

В клиентском предложении экспорт автоматически убирает служебные пометки — правила в `scripts/docs-export/jobs.json`.

## product — что система умеет и куда развивается

| Документ | О чём |
|---|---|
| [30_FEATURES_CATALOG.md](product/30_FEATURES_CATALOG.md) | Полный каталог функций: реализовано, запланировано, предложения. Очередь работ |
| [40_INDUSTRY_AGRICULTURE.md](product/40_INDUSTRY_AGRICULTURE.md) | Сельское хозяйство: применимость, что требует новых моделей, чего не обещать |
| [41_INDUSTRY_CONSTRUCTION.md](product/41_INDUSTRY_CONSTRUCTION.md) | Строительство: то же для строительных площадок |
| [AI-IMPROVEMENTS.md](product/AI-IMPROVEMENTS.md) | Развитие ИИ-части: анти-флуд, точность распознавания, план |

## architecture — инженерная документация

Полный указатель — [architecture/README.md](architecture/README.md). Ключевые точки входа:

| Документ | О чём |
|---|---|
| [00_VISION.md](architecture/00_VISION.md) | Позиционирование, рынки, режимы поставки, бизнес-модель |
| [01_SYSTEM_ARCHITECTURE.md](architecture/01_SYSTEM_ARCHITECTURE.md) | Устройство платформы, сервисы, потоки данных |
| [06_AI_ENGINE.md](architecture/06_AI_ENGINE.md) | Детекция, трекинг, идентификация, абстракция моделей |
| [07_PLUGIN_SYSTEM.md](architecture/07_PLUGIN_SYSTEM.md) | Модульная система функций |
| [13_SECURITY.md](architecture/13_SECURITY.md) | Безопасность, права, аудит |
| [14_FACTORY_MODULES.md](architecture/14_FACTORY_MODULES.md) | Промышленные модули и барьеры выхода на производство |
| [18_ROADMAP.md](architecture/18_ROADMAP.md) | План по кварталам |
| [25_GLOSSARY.md](architecture/25_GLOSSARY.md) | Термины |
| [ADR-0001-production-first-pivot.md](architecture/ADR-0001-production-first-pivot.md) | Решение: производство — основной рынок |
| [REVIEW_BOARD.md](architecture/REVIEW_BOARD.md) | Замечания ревью и реестр долга |

## operations — развернуть и эксплуатировать

| Документ | О чём |
|---|---|
| [DEPLOY.md](operations/DEPLOY.md) | Развёртывание на сервере |
| [INSTALL_UBUNTU_SERVER.md](operations/INSTALL_UBUNTU_SERVER.md) | Подготовка сервера с нуля |
| [OFFLINE-INSTALL.md](operations/OFFLINE-INSTALL.md) | Установка на объекте без интернета |
| [ARCHIVE-DISK.md](operations/ARCHIVE-DISK.md) | Подключение диска под видеоархив |
| [DETECTOR-RFDETR.md](operations/DETECTOR-RFDETR.md) | Переключение детектора с ultralytics на RF-DETR |
| [POSE-RTMO.md](operations/POSE-RTMO.md) | Перевод детекции падения на RTMO |
| [PPE-TRAINING.md](operations/PPE-TRAINING.md) | Обучение модели СИЗ на RF-DETR и открытых данных |
| [S3-SEAWEEDFS.md](operations/S3-SEAWEEDFS.md) | Перевод объектного хранилища с MinIO на SeaweedFS |
| [REID-DINOV2.md](operations/REID-DINOV2.md) | Переход сквозной идентификации на DINOv2 (текущий режим) |
| [REID-OSNET.md](operations/REID-OSNET.md) | То же для OSNet — устаревший режим, только для отката |
| [CAPACITY-ANALYSIS.md](operations/CAPACITY-ANALYSIS.md) | Расчёт железа: сколько камер и моделей тянет сервер |

## archive — не использовать в работе

Устаревшие материалы, сохранены для истории: срез состояния на июнь 2026, исходный запрос на генерацию архитектурной документации, ранние презентации и расчёты.

---

## Что где находится за пределами docs/

| Путь | Что это |
|---|---|
| `PLAN.md` | Текущее состояние, нерешённые проблемы, приоритеты. Главный файл для начала работы |
| `CLAUDE.md` | Архитектурные правила и соглашения для разработки |
| `pvz-onboarding/` | Комплект подключения точки: инструкции лежат рядом со скриптами и передаются вместе с ними. **Содержит реальные адреса и доступы — вне git** |
| `scripts/diag-*.sh` | Диагностика на боевом сервере |
| `graphify-out/` | Граф знаний по коду |

## Замечание по контролю версий

`.gitignore` содержит правило `docs`, поэтому вся эта папка **вне git**: истории изменений нет, резервной копии в удалённом репозитории нет. Для инженерной документации это неудобство, для коммерческих и юридических документов — риск. Решение о снятии правила — за владельцем.
