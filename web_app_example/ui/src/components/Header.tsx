import { Bot } from 'lucide-react';
import './Header.css';

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title = 'ADLC Builder', subtitle = 'Agentforce' }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-content">
        <span className="header-mark"><Bot size={22} /></span>
        <div className="header-text">
          <h1 className="header-title">{title}</h1>
          <p className="header-subtitle">{subtitle}</p>
        </div>
        <div className="header-controls"></div>
      </div>
    </header>
  );
}

export default Header;
