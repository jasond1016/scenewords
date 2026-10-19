import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, DotsThree } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";

const HeaderSlotContext = createContext<{
  header: HTMLElement | null;
  mobileMenu: HTMLElement | null;
}>({ header: null, mobileMenu: null });

export const HeaderSlotProvider = HeaderSlotContext.Provider;

/** Renders its children into the right side of the standard top bar. */
export function HeaderActions({
  children,
  mobileMenu = false,
}: {
  children: ReactNode;
  mobileMenu?: boolean;
}) {
  const slots = useContext(HeaderSlotContext);
  const slot = mobileMenu ? slots.mobileMenu ?? slots.header : slots.header;
  const content = mobileMenu ? (
    <div className="app-topbar-menu-action">{children}</div>
  ) : children;
  return slot ? createPortal(content, slot) : null;
}

function isWorksPath(pathname: string): boolean {
  return pathname.startsWith("/works");
}

function QueueDot({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return <span className="topbar-queue-dot tabular-nums">{count}</span>;
}

function PrimaryNavigation({ sidebarVisible = false, inProgressCount = 0, returnSessionId }: {
  sidebarVisible?: boolean;
  inProgressCount?: number;
  returnSessionId?: string;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navRef = useRef<HTMLElement | null>(null);
  const [fits, setFits] = useState(false);
  const visible = fits && !sidebarVisible;
  const state = returnSessionId === undefined ? location.state : returnSessionId ? { returnSessionId } : null;

  useLayoutEffect(() => {
    const nav = navRef.current;
    const header = nav?.closest<HTMLElement>(".topbar-inner");
    const leading = header?.querySelector<HTMLElement>(".app-topbar-leading");
    const trailing = header?.querySelector<HTMLElement>(".app-topbar-trailing");
    if (!nav || !header || !leading || !trailing) return;
    const measure = () => {
      const bounds = header.getBoundingClientRect();
      const center = (bounds.left + bounds.right) / 2;
      const gap = parseFloat(getComputedStyle(header).columnGap);
      const available = 2 * Math.min(center - leading.getBoundingClientRect().right - gap,
        trailing.getBoundingClientRect().left - center - gap);
      setFits(nav.getClientRects().length > 0 && nav.getBoundingClientRect().width <= available);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [header, nav, leading, trailing]) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={navRef} className="topbar-nav" data-visible={visible} aria-hidden={!visible} aria-label={t("nav.primary")}>
      {[
        { to: "/create", label: t("nav.create") },
        { to: "/works", label: t("nav.works") },
        { to: "/subjects", label: t("nav.subjects") },
      ].map((item) => (
        <NavLink key={item.to} to={item.to} state={state} tabIndex={visible ? 0 : -1}
          className="topbar-nav-link">
          {item.label}
          {item.to === "/works" && !isWorksPath(location.pathname) ? <QueueDot count={inProgressCount} /> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppTopBar({
  inProgressCount,
  onSlotChange,
  onMenuSlotChange,
}: {
  inProgressCount: number;
  onSlotChange: (element: HTMLDivElement | null) => void;
  onMenuSlotChange: (element: HTMLDivElement | null) => void;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useAppSettingsStore((state) => state.theme);
  const setSettings = useAppSettingsStore((state) => state.setSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnSessionId =
    (location.state as { returnSessionId?: string } | null)?.returnSessionId;
  const currentTitle = isWorksPath(location.pathname)
    ? t("nav.works")
    : location.pathname.startsWith("/settings")
      ? t("nav.settings")
      : t("nav.subjects");
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const backToConversation = () => {
    navigate("/create", {
      state: returnSessionId ? { returnSessionId } : null,
    });
  };

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path, { state: location.state });
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="app-topbar-leading">
          <button
            type="button"
            className="topbar-icon-btn app-topbar-back"
            aria-label={t("create.header.backToSession")}
            onClick={backToConversation}
          >
            <ArrowLeft size={19} />
          </button>
          <NavLink to="/create" state={location.state} className="wordmark">
            SceneWords
          </NavLink>
        </div>
        <PrimaryNavigation inProgressCount={inProgressCount} />
        <span className="app-topbar-mobile-title">{currentTitle}</span>
        <div className="app-topbar-trailing">
          <div className="topbar-actions" ref={onSlotChange} />
          <div className="dropdown-anchor app-topbar-more" ref={menuRef}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label={t("create.header.more")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <DotsThree size={20} weight="regular" />
            </button>
            {menuOpen ? (
              <div
                className="menu-popover"
                role="menu"
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest(".app-topbar-menu-action button")
                  ) {
                    setMenuOpen(false);
                  }
                }}
              >
                <div className="app-topbar-menu-actions" ref={onMenuSlotChange} />
                <div className="menu-divider app-topbar-action-divider" />
                <button type="button" role="menuitem" className="menu-item" onClick={() => go("/settings")}>
                  <span className="menu-item-label">{t("nav.settings")}</span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setSettings({ theme: isDark ? "light" : "dark" });
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu-item-label">
                    {isDark ? t("create.header.lightMode") : t("create.header.darkMode")}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export function CreateTopBar({
  breadcrumb,
  returnSessionId,
  sidebarVisible,
}: {
  breadcrumb: ReactNode;
  returnSessionId: string;
  sidebarVisible: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const theme = useAppSettingsStore((state) => state.theme);
  const setSettings = useAppSettingsStore((state) => state.setSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path, { state: returnSessionId ? { returnSessionId } : null });
  };

  return (
    <header className="topbar">
      <div className="topbar-inner topbar-inner-create">
        <div className="app-topbar-leading create-topbar-leading">
          {breadcrumb}
          <NavLink to="/create" className="wordmark create-desktop-brand">SceneWords</NavLink>
        </div>
        <PrimaryNavigation sidebarVisible={sidebarVisible} returnSessionId={returnSessionId} />
        <NavLink to="/create" className="wordmark wordmark-center create-mobile-brand">
          SceneWords
        </NavLink>
        <div className="topbar-actions app-topbar-trailing">
          <div className="dropdown-anchor" ref={menuRef}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("create.header.more")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <DotsThree size={20} weight="regular" />
            </button>
            {menuOpen ? (
              <div className="menu-popover" role="menu">
                <button type="button" role="menuitem" className="menu-item" onClick={() => go("/settings")}>
                  <span className="menu-item-label">{t("nav.settings")}</span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setSettings({ theme: isDark ? "light" : "dark" });
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu-item-label">
                    {isDark ? t("create.header.lightMode") : t("create.header.darkMode")}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
