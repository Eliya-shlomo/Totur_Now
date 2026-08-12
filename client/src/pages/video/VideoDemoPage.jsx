import { useState } from 'react';

import { createVideoAccess, createVideoRoom } from '@/api/videoApi';
import VideoRoom from '@/components/session/VideoRoom';

function VideoDemoPage() {
  const [roomUrl, setRoomUrl] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function startCall() {
    try {
      setLoading(true);
      setError(null);

      const room = await createVideoRoom('demo-session-123');

      const access = await createVideoAccess(room.roomName, 'Amit');

      setRoomUrl(room.roomUrl);
      setToken(access.token);
    } catch (err) {
      console.error(err);
      setError('Could not start video call.');
    } finally {
      setLoading(false);
    }
  }

  if (roomUrl && token) {
    return (
      <VideoRoom
        roomUrl={roomUrl}
        token={token}
        onJoined={() => console.log('Joined video room')}
        onLeft={() => console.log('Left video room')}
        onError={(error) => console.error('Video error:', error)}
      />
    );
  }

  return (
    <div>
      <h1>Daily Video Test</h1>

      <button onClick={startCall} disabled={loading}>
        {loading ? 'Starting...' : 'Start video call'}
      </button>

      {error && <p>{error}</p>}
    </div>
  );
}

export default VideoDemoPage;
