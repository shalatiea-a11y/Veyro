cd /home/user/Veyro/engelska-hafte
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Complete English Grammar Workbook</title><style>'; cat src/style.css; echo '</style></head><body>'; for f in p0 p1 p2a p2b p2c p3 p4 p5; do cat src/$f.html; echo; done; cat build/p6a.html src/p6b.html; echo '</body></html>'; } > build/book.html
