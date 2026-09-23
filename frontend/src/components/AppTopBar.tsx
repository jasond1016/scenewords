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

const HeaderSlotContext = createContext<HTMLElement | null>(null);

export const HeaderSlotProvider = HeaderSlotContext.Provider;

/** Renders its children into the right side of the standard top bar. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
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
}: {
  inProgressCount: number;
  onSlotChange: (element: HTMLDivElement | null) => void;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const navItems = [
    { to: "/create", label: t("nav.create") },
    { to: "/works", label: t("nav.works") },
    { to: "/subjects", label: t("nav.subjects") },
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="flex items-center">
          <NavLink to="/create" className="wordmark">
            SceneWords
          </NavLink>
        </div>
        <nav className="topbar-nav" aria-label={t("nav.primary")}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
        <div className="topbar-actions" ref={onSlotChange} />
      </div>
    </header>
  );
}

export function CreateTopBar({
  breadcrumb,
  onBack,
  inProgressCount,
}: {
  breadcrumb: ReactNode;
  onBack: () => void;
  inProgressCount: number;
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
    navigate(path);
  };

  return (
    <header className="topbar">
      <div className="topbar-inner topbar-inner-create">
        <div className="crumb">
          <button
            type="button"
            className="crumb-back"
            onClick={onBack}
            aria-label={t("create.header.back")}
            title={t("create.header.back")}
          >
            <ArrowLeft size={15} weight="regular" />
          </button>
          {breadcrumb}
        </div>
        <NavLink to="/create" className="wordmark wordmark-center">
          SceneWords
        </NavLink>
        <div className="topbar-actions" style={{ gap: "clamp(14px, 2.4vw, 26px)" }}>
          <NavLink to="/works" className="topbar-text-link">
            {t("nav.works")}
            <QueueDot count={inProgressCount} />
          </NavLink>
          <NavLink to="/subjects" className="topbar-text-link">
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
                <button type="button" role="menuitem" className="menu-item" onClick={() => go("/scenes")}>
                  <span className="menu-item-label">{t("nav.scenes")}</span>
                </button>
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
