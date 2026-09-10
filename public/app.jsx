import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import editorShell from './editor-shell.html?raw';
import './style.css';

function EditorApp() {
  const [startupError, setStartupError] = useState('');

  useEffect(() => {
    let mounted = true;

    import('./editor-controller.mjs').catch(error => {
      if (mounted) {
        setStartupError(
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="react-editor-root">
      <div dangerouslySetInnerHTML={{__html: editorShell}} />
      {startupError ? (
        <p className="error" role="alert">
          {startupError}
        </p>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<EditorApp />);
