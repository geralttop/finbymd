#!/usr/bin/env bash
# Собирает приложение и ставит его в меню приложений для текущего пользователя.
# Использование:
#   npm run install:local
#   npm run install:local -- --no-build
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    --no-build) SKIP_BUILD=1 ;;
    -h|--help)
      cat <<'HELP'
Установка finbymd в ~/.local:
  npm run install:local              собрать и установить
  npm run install:local -- --no-build  установить уже собранный бинарник
HELP
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $argument" >&2
      exit 1
      ;;
  esac
done
SKIP_BUILD="${SKIP_BUILD:-0}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APPLICATIONS_DIR="$DATA_DIR/applications"
ICONS_DIR="$DATA_DIR/icons/hicolor"
BINARY="$ROOT/src-tauri/target/release/finbymd"
DESKTOP_FILE="$APPLICATIONS_DIR/finbymd.desktop"

cd "$ROOT"

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "Собираю finbymd…"
  npm run tauri build -- --no-bundle
fi

if [[ ! -x "$BINARY" ]]; then
  echo "Не найден собранный бинарник: $BINARY" >&2
  echo "Запустите без --no-build или сначала выполните npm run tauri build." >&2
  exit 1
fi

echo "Устанавливаю в $BIN_DIR и $APPLICATIONS_DIR…"
mkdir -p \
  "$BIN_DIR" \
  "$APPLICATIONS_DIR" \
  "$ICONS_DIR/128x128/apps" \
  "$ICONS_DIR/256x256/apps" \
  "$ICONS_DIR/512x512/apps"

install -m 0755 "$BINARY" "$BIN_DIR/finbymd"
install -m 0644 "$ROOT/src-tauri/icons/128x128.png" "$ICONS_DIR/128x128/apps/finbymd.png"
install -m 0644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICONS_DIR/256x256/apps/finbymd.png"
install -m 0644 "$ROOT/src-tauri/icons/icon.png" "$ICONS_DIR/512x512/apps/finbymd.png"

# Кавычки вокруг Exec нужны, если в пути есть пробелы.
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=finbymd
GenericName=Finance Tracker
Comment=Учёт денег в markdown-файлах
Exec="$BIN_DIR/finbymd"
TryExec=$BIN_DIR/finbymd
Icon=finbymd
Terminal=false
Categories=Office;Finance;
Keywords=finances;money;markdown;учёт;деньги;
StartupNotify=true
StartupWMClass=finbymd
EOF
chmod 0644 "$DESKTOP_FILE"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP_FILE"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "$ICONS_DIR" >/dev/null 2>&1 || true
fi

echo
echo "Готово."
echo "Приложение в меню: finbymd"
echo "Команда запуска:   $BIN_DIR/finbymd"
echo
echo "Обновить после изменений:"
echo "  npm run install:local"
