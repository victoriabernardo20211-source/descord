import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// A fonte é importada do JS, não do CSS: importada pelo `@import` do Tailwind,
// o Vite não reescreve as URLs dos arquivos .woff2 e a fonte cai em silêncio
// para a do sistema. Aqui ele resolve os caminhos e emite os arquivos.
import '@fontsource-variable/geist';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
