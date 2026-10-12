cd /home/user/Veyro/engelska-hafte
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Complete English Grammar Workbook (writing edition)</title><style>'; cat src/style.css; cat <<'C'
.ex-list.w li{margin:2.2mm 0 3mm;padding-bottom:0}
.wl{border-bottom:1px solid #9aa5b5;height:7.2mm;margin-top:0}
.ml td{height:9.5mm}
.exb{break-inside:avoid}
.part+h2~p.ex{line-height:2.1}
C
echo '</style></head><body>'; for f in p0 p1 p2a p2b p2c p3 p4 p5; do cat src/$f.html; echo; done; cat build/p6w.html src/p6b.html; echo '</body></html>'; } > build/book_w.html
