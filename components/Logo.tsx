
import React from 'react';

interface LogoProps {
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
  return (
    <img 
      src="/logo.png" 
      alt="American Iron Official Logo" 
      className={className} 
    />
  );
};
