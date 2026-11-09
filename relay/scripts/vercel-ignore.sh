#!/bin/sh
# Étape « Ignored Build Step » de Vercel (vercel.json > ignoreCommand), lancée depuis le Root Directory (relay/).
# Code de sortie 0 : Vercel ignore ce commit (pas de déploiement) ; 1 : Vercel construit et déploie.
# On ne saute le déploiement que si l'on est sûr que rien n'a changé dans relay/ depuis le dernier déploiement
# réussi ; dans le doute (premier déploiement, historique incomplet, git absent), on déploie.
# Pour forcer un déploiement sans changement dans relay/ (ex. après un changement de variable d'environnement) :
# un commit dont le message contient « [deploy relay] ».

message="${VERCEL_GIT_COMMIT_MESSAGE:-}"
[ -n "$message" ] || message="$(git log -1 --format=%B 2>/dev/null || true)"
case "$message" in
  *"[deploy relay]"*)
    echo "Déploiement demandé par le message de commit : déploiement."
    exit 1
    ;;
esac

if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ]; then
  # Commit du dernier déploiement réussi de cette branche (fourni par Vercel à cette étape).
  base="$VERCEL_GIT_PREVIOUS_SHA"
  if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    echo "Dernier déploiement absent de l'historique cloné : déploiement."
    exit 1
  fi
elif [ "${VERCEL:-}" = "1" ]; then
  echo "Aucun déploiement précédent pour cette branche : déploiement."
  exit 1
else
  # Hors Vercel (essai local) : comparaison avec le commit parent, s'il existe.
  base="HEAD^"
  if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null 2>&1; then
    echo "Pas de commit parent (premier commit) : déploiement."
    exit 1
  fi
fi

if git diff --quiet "$base" HEAD -- .; then
  echo "Aucun changement dans relay/ depuis ${base} : déploiement ignoré."
  exit 0
fi
echo "Changements dans relay/ depuis ${base} : déploiement."
exit 1
