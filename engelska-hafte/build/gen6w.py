import re
from ex import CH
def gap(q): return q.replace('___','<span class="gap"></span>')
o=['<div class="part"><h1>Part 6</h1><p class="sub">Practice, answer key, quick reference, sources</p></div>']
o.append('<h2><span class="n">★</span>Exercises 1–29</h2><p>Write your answers in pencil. Check with the answer key <b>only after</b> you finish a whole exercise. Write your answers on the lines. Copy every mistake into your mistake list (right after the exercises).</p>')
n=0
for num,title,instr,items in CH:
    n+=len(items)
    o.append(f'<div class="exb"><h3>Exercise {num}: {title}</h3><p class="small">{instr}</p><ol class="ex-list">'+''.join(f'<li>{gap(q)}<div class="wl"></div>'+('<div class="wl"></div>' if len(a)>30 else '')+'</li>' for q,a in items)+'</ol></div>')
rows=''.join('<tr><td></td><td></td><td></td></tr>' for _ in range(22))
o.append('<div class="nb"></div><h2><span class="n">★</span>My mistake list</h2><p>Write every mistake here: the <b>rule</b>, the <b>wrong</b> sentence and the <b>correct</b> sentence. Read this list before every writing test.</p><table class="ml"><tr><th style="width:28%">Rule / chapter</th><th>Wrong → Correct</th><th style="width:14%">Repeated</th></tr>'+rows+'</table>')
o.append('<div class="nb"></div><p class="small">My mistake list (continued)</p><table class="ml"><tr><th style="width:28%">Rule / chapter</th><th>Wrong → Correct</th><th style="width:14%">Repeated</th></tr>'+rows+'</table>')

o.append('''<div class="nb"></div><h2><span class="n">★</span>Find the mistakes</h2>
<p>Each text contains hidden mistakes. Use the 6-pass method (chapter 29). Underline each mistake and write the correction in the margin. The number of mistakes is given. Check the key at the end.</p>
<h3>Text A: My weekend (12 mistakes)</h3>
<p class="ex">Last weekend I have visited my grandmother. She live in a small village near Göteborg. We went their by train, and it taked two hours. When we arrived, my grandmother was cooking dinner. She is very good in cooking, and the food was delicious. After the dinner we looked at old photos. I learned alot about my family history. I also met my cousin which lives nearby. Before I left, she gived me two advices about studying. I enjoyed me very much. In the evening it was raining, so we stayed inside and played cards. I was so tired that I fell asleep immediately. Next weekend I will visit her again, if I will have time.</p><p class="small">Write the corrections here:</p><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div>
<h3>Text B: Social media (14 mistakes)</h3>
<p class="ex">Nowadays many teenager spend too much time on social media. According to a recent study, young people use their phones for more than five hours every days. Some people says that this is not a problem, but I disagree with them. There is many reasons for this. First of all, social media can affect your sleep bad. If you stay up late looking at your phone, you will be tired in the morning. The informations in the report are clear. I am agree with the experts, who say that sleeping eight hours is more better than scrolling. Furthermore, it is easy to compare yourself with others, which can make you feeling unhappy. Despite of these problems, social media also has advantages. For example, it help us to keep in touch with friends who lives far away. In my opinion, the key is to use it less and to spend more time with real people. Everyone should decide how much time they want to spend on his phone.</p><p class="small">Write the corrections here:</p><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div>
<h3>Text C: A formal email (14 mistakes)</h3>
<p class="ex">Dear Sir or Madam,<br>I am writing to complain about the laptop that I bought from your shop last week. Unfortunately, the screen stopped working after only three days, and the laptop didn't worked properly from the beginning. I have contacted your customer service yesterday, but nobody answered to me. I am very disappointed, specially because it was a expensive model. Me and my family depend of this computer for school and work. I would like to know if you can to repair it or give me my money back. I have attached a copy of the receipt, which prove that I bought it on 3 October. Please send me a answer and more informations about your return policy. If I will not hear from you within a week, I will contact the consumer agency. I look forward to hear from you soon.<br>Yours sincerely,<br>Karl Nilsson</p><p class="small">Write the corrections here:</p><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div><div class="wl"></div>''')

o.append('<div class="nb"></div><h2><span class="n">★</span>Answer key</h2><div class="ans three">')
for num,title,instr,items in CH:
    o.append(f'<h3>{num}. {title}</h3>')
    o.append('<p>'+'<br>'.join(f'<b>{i}</b> {a}' for i,(q,a) in enumerate(items,1))+'</p>')
o.append('</div>')
o.append('''<h3>Find the mistakes: key</h3><div class="ans">
<p><b>Text A (12):</b> 1 have visited → visited · 2 live → lives · 3 their → there · 4 taked → took · 5 good in → good at · 6 After the dinner → After dinner · 7 alot → a lot · 8 cousin which → cousin who · 9 gived → gave · 10 two advices → two pieces of advice / some advice · 11 enjoyed me → enjoyed myself · 12 if I will have → if I have.</p>
<p><b>Text B (14):</b> 1 many teenager → teenagers · 2 every days → every day · 3 people says → say · 4 There is many → There are many · 5 sleep bad → badly · 6 The informations → The information · 7 …are clear → is clear · 8 I am agree → I agree · 9 more better → better · 10 make you feeling → feel · 11 Despite of → Despite · 12 it help → helps · 13 friends who lives → live · 14 on his phone → on their phone.</p>
<p><b>Text C (14):</b> 1 didn't worked → didn't work · 2 have contacted … yesterday → contacted · 3 answered to me → answered me · 4 specially → especially · 5 a expensive → an expensive · 6 Me and my family → My family and I · 7 depend of → depend on · 8 can to repair → can repair · 9 which prove → which proves · 10 a answer → an answer · 11 informations → information · 12 If I will not hear → If I do not hear · 13 look forward to hear → to hearing · 14 Yours sincerely → Yours faithfully (after "Dear Sir or Madam").</p></div>''')
open('p6w.html','w').write('\n'.join(o))
print(n)
