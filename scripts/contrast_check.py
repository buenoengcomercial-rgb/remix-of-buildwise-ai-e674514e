# Checklist WCAG 2.1 — Contraste de capítulos/subcapítulos/datas do GanttChart
# Fórmulas: https://www.w3.org/TR/WCAG21/#contrast-minimum

import math

def hsl_to_rgb(h, s, l):
    s /= 100; l /= 100
    c = (1 - abs(2*l - 1)) * s
    x = c * (1 - abs((h/60) % 2 - 1))
    m = l - c/2
    if   0   <= h < 60:  r,g,b = c,x,0
    elif 60  <= h < 120: r,g,b = x,c,0
    elif 120 <= h < 180: r,g,b = 0,c,x
    elif 180 <= h < 240: r,g,b = 0,x,c
    elif 240 <= h < 300: r,g,b = x,0,c
    else:                r,g,b = c,0,x
    return tuple(round((v+m)*255) for v in (r,g,b))

def rel_luminance(rgb):
    def chan(c):
        c /= 255
        return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
    r,g,b = (chan(c) for c in rgb)
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(fg, bg):
    L1, L2 = rel_luminance(fg), rel_luminance(bg)
    lighter, darker = max(L1,L2), min(L1,L2)
    return (lighter + 0.05) / (darker + 0.05)

def grade(ratio, large=False):
    aaa = 4.5 if large else 7.0
    aa  = 3.0 if large else 4.5
    if ratio >= aaa: return "AAA ✅"
    if ratio >= aa:  return "AA  ✅"
    if ratio >= 3.0: return "AA-large ⚠️"
    return "FAIL ❌"

def hsl(h,s,l): return hsl_to_rgb(h,s,l)

# === Pares cor/fundo usados no GanttChart.tsx (após últimos ajustes) ===
checks = [
    # --- Sidebar EAP: cabeçalho do capítulo principal ---
    ("Capítulo principal — nome (12px bold)",
     hsl(220,10,15), hsl(220,8,72), True),  # large = >=14px bold
    ("Capítulo principal — número/contador (9px)",
     hsl(220,10,22), hsl(220,8,72), False),
    ("Capítulo principal — chevron (50% opac aproximado)",
     hsl(220,10,15), hsl(220,8,72), False),

    # --- Sidebar EAP: cabeçalho do subcapítulo ---
    ("Subcapítulo — nome (11px semibold)",
     hsl(220,10,20), hsl(220,8,84), False),
    ("Subcapítulo — número/contador (9px)",
     hsl(220,10,28), hsl(220,8,84), False),

    # --- Linha de datas do capítulo (mesmo fundo) ---
    ("Datas — label 'Início:'/'Fim:' sobre cap. principal",
     hsl(220,10,25), hsl(220,8,72), False),
    ("Datas — label sobre subcapítulo",
     hsl(220,10,30), hsl(220,8,84), False),
    ("Datas — VALOR (data/dias) sobre cap. principal",
     hsl(220,10,8),  hsl(220,8,72), False),
    ("Datas — VALOR (data/dias) sobre subcapítulo",
     hsl(220,10,8),  hsl(220,8,84), False),

    # --- Lado direito: faixa do header do capítulo no Gantt ---
    ("Gantt — label do capítulo principal (9px bold)",
     hsl(220,10,20), hsl(220,8,91), False),
    ("Gantt — label do subcapítulo (9px semibold)",
     hsl(220,10,35), hsl(220,8,95), False),
    ("Gantt — diamantes (capítulo principal)",
     hsl(220,10,25), hsl(220,8,91), False),
    ("Gantt — diamantes (subcapítulo)",
     hsl(220,10,40), hsl(220,8,95), False),
    ("Gantt — linha de span (capítulo principal)",
     hsl(220,10,35), hsl(220,8,91), False),
    ("Gantt — linha de span (subcapítulo)",
     hsl(220,10,50), hsl(220,8,95), False),
]

print(f"{'Item':<58} {'Ratio':>6}  Grade")
print("-"*85)
worst_text, worst_ratio = None, 99
for name, fg, bg, large in checks:
    r = contrast(fg, bg)
    g = grade(r, large)
    flag = "(grande)" if large else ""
    print(f"{name:<58} {r:>5.2f}:1  {g} {flag}")
    if "FAIL" in g or "large" in g and not large:
        if r < worst_ratio:
            worst_ratio = r; worst_text = name

print("\nReferência WCAG 2.1:")
print("  Texto normal: AA ≥ 4.5,  AAA ≥ 7.0")
print("  Texto grande (≥18px ou ≥14px bold): AA ≥ 3.0, AAA ≥ 4.5")
print("  Componentes/UI não-texto: ≥ 3.0 (recomendação)")

if worst_text:
    print(f"\n⚠️  Pior caso fora do AA: {worst_text} ({worst_ratio:.2f}:1)")
else:
    print("\n✅ Todos os pares passam pelo critério aplicável.")
