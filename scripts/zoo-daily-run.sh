#!/bin/bash
# Zoo Shorts daily production run — the ONE sanctioned way to start an episode.
# Lives in the repo because sandbox scratchpads get wiped by restarts.
#
# Usage: zoo-daily-run.sh            -> sign in + mine trends + start a run
#        zoo-daily-run.sh status ID  -> poll run status once
#
# Trend mining ("follow the winners"): top-viewed toddler-song videos of the
# last 60 days feed the idea/metadata agents so every episode targets proven
# demand. COVERED_TOPICS below are prepended as forbidden markers — append a
# line after every published episode so the channel never repeats itself.
set -e
BASE="${ZOO_BASE:-https://business-factory-woad.vercel.app}"
JAR="${ZOO_COOKIE_JAR:-/tmp/zoo-cookies.txt}"

# Topics the channel has already published (append, never remove):
COVERED_TOPICS=(
  "bath time / splish splash / washing"
  "stomping / elephant marching"
  "counting bananas / number counting / one two three"
)

signin() {
  rm -f "$JAR"
  CSRF=$(curl -sS -c "$JAR" "$BASE/api/auth/csrf" | python3 -c "import json,sys; print(json.load(sys.stdin)['csrfToken'])")
  curl -sS -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
    -H "content-type: application/x-www-form-urlencoded" \
    --data-urlencode "csrfToken=$CSRF" \
    --data-urlencode "email=owner@factory.local" \
    --data-urlencode "password=factory-dev-password" \
    -o /dev/null -w "%{http_code}\n"
}

covered_only() {
  printf '%s\n' "${COVERED_TOPICS[@]}" | python3 -c "
import json,sys
rows=[{'title':'ALREADY PUBLISHED ON OUR CHANNEL - NEVER REUSE THIS TOPIC: '+l.strip(),'views':0,'channel':'Zoo Friends (ours)'} for l in sys.stdin if l.strip()]
print(json.dumps(rows))"
}

trends() {
  AT=$(curl -sS --max-time 30 -X POST https://oauth2.googleapis.com/token \
    -d client_id="$YT_CLIENT_ID" -d client_secret="$YT_CLIENT_SECRET" \
    -d refresh_token="$YT_REFRESH_TOKEN" -d grant_type=refresh_token \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
  [ -z "$AT" ] && covered_only && return
  AFTER=$(date -u -d '60 days ago' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v-60d +%Y-%m-%dT00:00:00Z)
  IDS=""
  for Q in "nursery rhymes for toddlers song" "counting songs for kids" "animal dance song for toddlers"; do
    R=$(curl -sS --max-time 30 -G "https://www.googleapis.com/youtube/v3/search" \
      -H "Authorization: Bearer $AT" \
      --data-urlencode "part=snippet" --data-urlencode "q=$Q" \
      --data-urlencode "type=video" --data-urlencode "order=viewCount" \
      --data-urlencode "publishedAfter=$AFTER" --data-urlencode "maxResults=8" \
      --data-urlencode "relevanceLanguage=en" --data-urlencode "safeSearch=strict" || echo '{}')
    IDS="$IDS,$(echo "$R" | python3 -c "import json,sys; print(','.join(i['id']['videoId'] for i in json.load(sys.stdin).get('items',[]) if i.get('id',{}).get('videoId')))" 2>/dev/null)"
  done
  IDS=$(echo "$IDS" | sed 's/^,//; s/,,*/,/g')
  [ -z "$IDS" ] && covered_only && return
  COVERED_JSON=$(printf '%s\n' "${COVERED_TOPICS[@]}" | python3 -c "
import json,sys
rows=[{'title':'ALREADY PUBLISHED ON OUR CHANNEL - NEVER REUSE THIS TOPIC: '+l.strip(),'views':0,'channel':'Zoo Friends (ours)'} for l in sys.stdin if l.strip()]
print(json.dumps(rows))")
  curl -sS --max-time 30 -G "https://www.googleapis.com/youtube/v3/videos" \
    -H "Authorization: Bearer $AT" \
    --data-urlencode "part=snippet,statistics" --data-urlencode "id=$IDS" | python3 -c "
import json,sys
covered=json.loads('''$COVERED_JSON''')
items=json.load(sys.stdin).get('items',[])
rows=[{'title':i['snippet']['title'][:110],'views':int(i.get('statistics',{}).get('viewCount',0)),'channel':i['snippet']['channelTitle'][:40]} for i in items]
rows.sort(key=lambda r:-r['views'])
print(json.dumps(covered+rows[:13]))" 2>/dev/null || echo "[]"
}

case "${1:-start}" in
  signin) signin ;;
  start)
    signin >/dev/null
    T=$(trends || covered_only || echo "[]"); [ -z "$T" ] && T=$(covered_only)
    echo "trends: $(echo "$T" | python3 -c "import json,sys; d=json.load(sys.stdin); real=[r for r in d if r['views']>0]; print(len(real),'topics, top:', real[0]['title'][:60] if real else 'NONE - agent must rotate fresh topics')" 2>/dev/null)" >&2
    BODY=$(python3 -c "import json,sys; print(json.dumps({'input':{'trending':json.loads(sys.argv[1])}}))" "$T")
    curl -sS -b "$JAR" -X POST "$BASE/api/workflows/zoo-shorts-pipeline/run" \
      -H "content-type: application/json" -d "$BODY"
    echo ;;
  status)
    curl -sS -b "$JAR" "$BASE/api/runs/$2" ;;
esac
