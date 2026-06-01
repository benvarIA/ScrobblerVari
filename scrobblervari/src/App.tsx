import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import CallbackPage from './pages/CallbackPage'
import HomePage from './pages/HomePage'
import VinylPage from './pages/VinylPage'
import StatsPage from './pages/StatsPage'
import CleanPage from './pages/CleanPage'
import NotFoundPage from './pages/NotFoundPage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/vinyl" element={<VinylPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/clean" element={<CleanPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
