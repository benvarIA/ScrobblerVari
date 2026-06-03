import { useState, useCallback, useRef, useEffect } from 'react'

export function useFetch<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(fetcher)

  useEffect(() => { ref.current = fetcher })

  const execute = useCallback(async (): Promise<{ data: T | null; error: string | null }> => {
    setLoading(true)
    setError(null)
    try {
      const result = await ref.current()
      setData(result)
      return { data: result, error: null }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue'
      setError(msg)
      return { data: null, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, execute }
}
