import {
  CaretLeft,
  Eye,
  EyeSlash,
  FunnelSimple,
  Info,
  List,
  ShieldCheck,
  SignOut,
  Tray,
  Warning,
  WarningCircle,
  X,
  type Icon,
  type IconProps,
} from '@phosphor-icons/react';

/**
 * The app's icon set: Phosphor, regular weight, 18px, hidden from screen readers
 * (every icon sits next to a text label or inside a labelled button).
 */
const icon = (Glyph: Icon) =>
  function AppIcon(props: IconProps) {
    return <Glyph size={18} weight="regular" aria-hidden="true" focusable="false" {...props} />;
  };

export const ShieldIcon = icon(ShieldCheck);
export const InboxIcon = icon(Tray);
export const SignOutIcon = icon(SignOut);
export const WarningIcon = icon(Warning);
export const ErrorIcon = icon(WarningCircle);
export const InfoIcon = icon(Info);
export const MenuIcon = icon(List);
export const CloseIcon = icon(X);
export const FilterIcon = icon(FunnelSimple);
export const BackIcon = icon(CaretLeft);
export const EyeIcon = icon(Eye);
export const EyeOffIcon = icon(EyeSlash);
