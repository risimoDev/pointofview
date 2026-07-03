COMPOSE := docker compose -f infra/docker-compose.dev.yml --env-file infra/.env
ENV_FILE := infra/.env
BACKUP_DIR := /mnt/data/backups

-include $(ENV_FILE)

.PHONY: install init deploy update logs shell-api shell-analyzer db-migrate db-reset backup restore

install:
	sudo ./scripts/install.sh

init:
	./scripts/init.sh $(ARGS)

deploy:
	./scripts/deploy.sh $(ARGS)

update:
	./scripts/update.sh

logs:
	$(COMPOSE) logs -f --tail 100 $(S)

shell-api:
	$(COMPOSE) exec api sh

shell-analyzer:
	$(COMPOSE) exec analyzer bash

db-migrate:
	$(COMPOSE) exec -T api npm run migrate

# DEV ONLY: drops the postgres volume and re-initializes from scratch
db-reset:
	@echo "This DESTROYS all data. Ctrl-C to abort."; sleep 5
	$(COMPOSE) rm -fsv postgres
	docker volume rm viziai-dev_pg_data || true
	$(COMPOSE) up -d postgres
	sleep 5
	$(COMPOSE) run --rm api npm run migrate

backup:
	@mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T postgres pg_dump -U $(POSTGRES_USER) $(POSTGRES_DB) \
		| gzip > $(BACKUP_DIR)/$$(date +%F).sql.gz
	@echo "Backup: $(BACKUP_DIR)/$$(date +%F).sql.gz"

# usage: make restore FILE=/mnt/data/backups/2026-06-11.sql.gz
restore:
	@test -n "$(FILE)" || { echo "Usage: make restore FILE=path.sql.gz"; exit 1; }
	gunzip -c $(FILE) | $(COMPOSE) exec -T postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)
	@echo "Restored from $(FILE)"
