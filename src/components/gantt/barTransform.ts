/**
 * Camada utilitária para mutações DOM transitórias nas barras do Gantt
 * (drag/resize). Garante:
 *  - Não conflitar com os estilos inline gerenciados pelo React: cada
 *    propriedade é mexida apenas se for "marcada" via begin().
 *  - Limpeza completa ao cancelar/encerrar, mesmo se ocorrer erro:
 *    apenas as propriedades modificadas são restauradas (não zera tudo).
 *  - Ponto único para escrever (write-coalesced via rAF na chamada do caller).
 *
 * Uso típico:
 *   const session = beginBarMutation(el, ['transform', 'transition', 'opacity']);
 *   setTransform(el, `translateX(${dx}px)`);
 *   ...
 *   endBarMutation(session); // restaura tudo o que foi marcado
 */

export type MutableProp = 'transform' | 'transition' | 'opacity' | 'left' | 'width';

export interface BarMutationSession {
  el: HTMLElement;
  /** snapshot do valor inline original de cada propriedade marcada */
  original: Partial<Record<MutableProp, string>>;
  /** propriedades que o caller declarou que pode tocar */
  owned: Set<MutableProp>;
  ended: boolean;
}

/**
 * Inicia uma sessão de mutação para um elemento, capturando o estado
 * original APENAS das propriedades declaradas. Qualquer outra propriedade
 * inline (gerenciada pelo React) permanece intocada.
 */
export function beginBarMutation(
  el: HTMLElement | null | undefined,
  props: MutableProp[],
): BarMutationSession | null {
  if (!el) return null;
  const original: Partial<Record<MutableProp, string>> = {};
  for (const p of props) {
    original[p] = el.style.getPropertyValue(p);
  }
  return { el, original, owned: new Set(props), ended: false };
}

function assertOwned(session: BarMutationSession, prop: MutableProp) {
  if (!session.owned.has(prop)) {
    // Em dev, ajuda a pegar bugs de uso. Em prod, apenas ignoramos a mudança.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[barTransform] Propriedade "${prop}" não foi declarada em beginBarMutation.`);
    }
  }
}

export function setTransform(session: BarMutationSession | null, value: string) {
  if (!session || session.ended) return;
  assertOwned(session, 'transform');
  session.el.style.transform = value;
}

export function setTransition(session: BarMutationSession | null, value: string) {
  if (!session || session.ended) return;
  assertOwned(session, 'transition');
  session.el.style.transition = value;
}

export function setOpacity(session: BarMutationSession | null, value: string) {
  if (!session || session.ended) return;
  assertOwned(session, 'opacity');
  session.el.style.opacity = value;
}

export function setLeftPx(session: BarMutationSession | null, valuePx: number) {
  if (!session || session.ended) return;
  assertOwned(session, 'left');
  session.el.style.left = `${valuePx}px`;
}

export function setWidthPx(session: BarMutationSession | null, valuePx: number) {
  if (!session || session.ended) return;
  assertOwned(session, 'width');
  session.el.style.width = `${valuePx}px`;
}

/**
 * Restaura APENAS as propriedades marcadas para os valores originais.
 * Idempotente — chamar várias vezes é seguro.
 */
export function endBarMutation(session: BarMutationSession | null) {
  if (!session || session.ended) return;
  session.ended = true;
  const { el, original } = session;
  for (const prop of session.owned) {
    const orig = original[prop] ?? '';
    if (orig === '') {
      el.style.removeProperty(prop);
    } else {
      el.style.setProperty(prop, orig);
    }
  }
}

/** Encerra um lote de sessões de uma vez (drag com propagação a sucessores). */
export function endAllBarMutations(sessions: Iterable<BarMutationSession | null>) {
  for (const s of sessions) endBarMutation(s);
}
