# Обучение модели СИЗ (каска, жилет)

**Зачем:** заменить модель СИЗ на ultralytics — последний компонент под AGPL-3.0 в анализаторе. Обоснование — [../commercial/01_LICENSE_REMEDIATION.md](../commercial/01_LICENSE_REMEDIATION.md).

**Где запускать:** на сервере с видеокартой. Проверка датасета работает где угодно, обучение и оценка — **только внутри контейнера анализатора**: `rfdetr`, torch и CUDA стоят там, на хосте их нет.

---

## 1. Датасет

Нужен экспорт в формате **COCO** с такой раскладкой:

```
/data/ppe/train/_annotations.coco.json + изображения
/data/ppe/valid/_annotations.coco.json + изображения
```

Открытые наборы с пригодной лицензией (CC BY 4.0 — коммерческое использование разрешено при указании авторства):

- [HardHat & SafetyVest](https://universe.roboflow.com/ppe-kit-detection/hardhat-safetyvest) — около 22 тысяч изображений, каски и жилеты
- [Construction Site Safety](https://universe.roboflow.com/roboflow-universe-projects/construction-site-safety) — каски, жилеты, техника, конусы

На странице датасета: **Download this Dataset** → формат **COCO** → получите либо ссылку с ключом, либо zip. Распакуйте в `/data/ppe`.

Запишите происхождение и лицензию каждого набора в `THIRD_PARTY_LICENSES.md` — это то, что спросит служба безопасности заказчика.

## 2. Предполётная проверка

Обязательный шаг. Анализатор резолвит классы СИЗ **по именам** (`analyzer/plugins/ppe.py`), поэтому датасет с классами вроде `class_0` обучится нормально и окажется непригоден.

```bash
python3 scripts/train_ppe.py check --data /data/ppe
```

Проверка покажет, какие классы распознаны как каска и жилет, какие анализатор проигнорирует (отрицательные `NO-Hardhat` — это норма, отсутствие выводится само) и хватает ли разметок. Класс `Safety Vest` подходит: сопоставление идёт по подстроке.

Не распознаны — переименуйте классы в датасете либо задайте `class_map` в конфигурации функции `ppe`.

## 3. Обучение

Освободите видеопамять — Ollama занимает около 5 ГБ:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod stop ollama
```

Запуск внутри контейнера анализатора:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm --no-deps -v "$PWD/scripts:/mig" -v /data/ppe:/data/ppe -v /opt/train:/opt/train analyzer python /mig/train_ppe.py train --data /data/ppe --out /opt/train/ppe --epochs 30 --batch 2 --grad-accum 8
```

На 3070 при 8 ГБ памяти держите `--batch 2 --grad-accum 8`: это даёт эффективный размер пакета 16 без переполнения. Разрешение по умолчанию 672 — то же, на котором работает анализатор, менять его без причины не нужно.

Обучение на 22 тысячах изображений идёт часами. Запускайте на ночь.

## 4. Оценка перед выкатом

Считаются точность, полнота и F1 по двум классам, которые реально использует продукт, при той же уверенности, что стоит в анализаторе:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm --no-deps -v "$PWD/scripts:/mig" -v /data/ppe:/data/ppe -v /opt/train:/opt/train analyzer python /mig/train_ppe.py eval --data /data/ppe --weights /opt/train/ppe/checkpoint_best_total.pth
```

При замене уже работающей модели добавьте `--baseline /models/ppe_prev.pth`. Скрипт сравнит F1 и **завершится с ошибкой, если новая модель хуже**. Это защита от самого дорогого предположения в конвейере — «новая версия очевидно лучше».

## 5. Установка

```bash
cp /opt/train/ppe/checkpoint_best_total.pth ${DATA_ROOT}/models/ppe_rfdetr.pth
```

В `infra/.env.prod`:

```
PPE_BACKEND=rfdetr
PPE_MODEL=/models/ppe_rfdetr.pth
```

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod start ollama
```

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --no-deps --force-recreate analyzer
```

Проверка — в логе не должно остаться предупреждения про AGPL от вспомогательного детектора:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod logs --tail 100 analyzer | grep -E "aux detector|ppe"
```

Затем включите функцию «Средства защиты (СИЗ)» в `/admin/features` и проверьте по существу: пройти по зоне с каской и без неё.

## 6. Ожидания от модели на открытых данных

Она будет средней: чужие каски, чужое освещение, чужие ракурсы. Её задача — **снять лицензионный блокер** и дать рабочую базу для демонстраций. Точность под конкретное производство достигается дообучением на кадрах заказчика во время пилота, и именно это мы продаём как отличие от коробочных решений.

Порог уверенности после смены модели почти наверняка потребует подстройки — он задаётся в конфигурации функции `ppe`.
