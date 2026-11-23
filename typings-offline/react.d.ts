// Declarações mínimas de React usadas APENAS para checagem de tipos offline
// (o ambiente de desenvolvimento não tinha @types/react). Com `npm install`,
// @types/react e @types/react-dom substituem este arquivo.
declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = any;
  export type CSSProperties = { [k: string]: string | number | undefined };
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly unknown[]): T;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
  export const StrictMode: any;
  export const Fragment: any;
  const React: { StrictMode: any; Fragment: any };
  export default React;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [name: string]: any;
    }
    interface IntrinsicAttributes {
      key?: string | number | null;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void; unmount(): void };
}
