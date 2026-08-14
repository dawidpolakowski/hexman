import Versions from './components/Versions'

function App(): React.JSX.Element {
  return (
    <>
      <div className="creator">Hexman</div>
      <div className="text">API testing for testers</div>
      <p className="tip">REST and GraphQL request support is coming soon.</p>
      <div className="actions">
        <div className="action">
          <a href="https://github.com/dawidpolakowski/Hexman" target="_blank" rel="noreferrer">
            Repository
          </a>
        </div>
      </div>
      <Versions></Versions>
    </>
  )
}

export default App
