import {
  createContext,
  useContext,
  useEffect,
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
  const navItems = [
    { to: "/create", label: t("nav.create") },
    { to: "/works", label: t("nav.works") },
    { to: "/subjects", label: t("nav.subjects") },
  ];

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
        <div className="app-topbar-leading flex items-center">
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
        <nav className="topbar-nav" aria-label={t("nav.primary")}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              state={location.state}
              className={({ isActive }) =>
                `topbar-nav-link ${isActive ? "topbar-nav-link-active" : ""}`
              }
            >
              {item.label}
              {item.to === "/works" && !isWorksPath(location.pathname) ? (
                <QueueDot count={inProgressCount} />
              ) : null}
            </NavLink>
          ))}
        </nav>
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
              <DotsThree size={22} weight="bold" />
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
  inProgressCount,
  returnSessionId,
}: {
  breadcrumb: ReactNode;
  inProgressCount: number;
  returnSessionId: string;
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
        <div className="crumb">
          {breadcrumb}
        </div>
        <NavLink to="/create" className="wordmark wordmark-center">
          SceneWords
        </NavLink>
        <div className="topbar-actions" style={{ gap: "clamp(14px, 2.4vw, 26px)" }}>
          <NavLink to="/works" state={returnSessionId ? { returnSessionId } : null} className="topbar-text-link create-desktop-nav-link">
            {t("nav.works")}
            <QueueDot count={inProgressCount} />
          </NavLink>
          <NavLink to="/subjects" state={returnSessionId ? { returnSessionId } : null} className="topbar-text-link create-desktop-nav-link">
            {t("nav.subjects")}
          </NavLink>
          <div className="dropdown-anchor" ref={menuRef}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("create.header.more")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <DotsThree size={22} weight="bold" />
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
