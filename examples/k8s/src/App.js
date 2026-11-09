import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={require('./kublogo.png')}/>
        <p>
          Containerized React app deployed to Kubernetes cluster via <a href="https://runme.dev" style={{color: '#F62459'}}><b style={{color: 'white'}}>Runme</b></a>
        </p>
      </header>
    </div>
  );
}

export default App;
