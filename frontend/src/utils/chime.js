/**
 * Play a pleasant chime sound using Web Audio API
 */
export function playChime() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)()
    
    // Create a pleasant chime using multiple frequencies
    const frequencies = [523.25, 659.25, 783.99] // C, E, G notes (C major chord)
    const duration = 0.3
    const gainNode = audioContext.createGain()
    
    gainNode.connect(audioContext.destination)
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration)
    
    frequencies.forEach((freq, index) => {
      const oscillator = audioContext.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(freq, audioContext.currentTime)
      
      const noteGain = audioContext.createGain()
      noteGain.gain.setValueAtTime(0, audioContext.currentTime)
      noteGain.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05)
      noteGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration)
      
      oscillator.connect(noteGain)
      noteGain.connect(gainNode)
      
      oscillator.start(audioContext.currentTime + index * 0.05)
      oscillator.stop(audioContext.currentTime + duration)
    })
  } catch (error) {
    console.error('Failed to play chime:', error)
    // Fallback: try using a simple beep
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      oscillator.frequency.value = 800
      oscillator.type = 'sine'
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
      
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.3)
    } catch (fallbackError) {
      console.error('Fallback chime also failed:', fallbackError)
    }
  }
}

