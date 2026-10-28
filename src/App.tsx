import { LockScreen } from './components/LockScreen'
import { VaultView } from './components/VaultView'
import { useVault } from './hooks/useVault'

export default function App() {
  const { status } = useVault()
  return status === 'unlocked' ? <VaultView /> : <LockScreen />
}
