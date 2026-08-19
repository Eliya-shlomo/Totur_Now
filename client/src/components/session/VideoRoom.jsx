import { useCallFrame } from '@daily-co/daily-react';
import { useEffect, useRef } from 'react';

function VideoRoom({ roomUrl, token, onJoined, onLeft, onError }) {
  const containerRef = useRef(null);
  const joinedRef = useRef(false);

  const callFrame = useCallFrame({
    parentElRef: containerRef,
    options: {
      showLeaveButton: true,
      iframeStyle: {
        width: '100%',
        height: '100%',
        border: '0',
      },
    },
  });

  useEffect(() => {
    if (!callFrame) return;

    function handleJoined() {
      onJoined?.();
    }

    function handleLeft() {
      joinedRef.current = false;
      onLeft?.();
    }

    function handleError(error) {
      joinedRef.current = false;
      onError?.(error);
    }

    callFrame.on('joined-meeting', handleJoined);
    callFrame.on('left-meeting', handleLeft);
    callFrame.on('error', handleError);

    return () => {
      callFrame.off('joined-meeting', handleJoined);
      callFrame.off('left-meeting', handleLeft);
      callFrame.off('error', handleError);
    };
  }, [callFrame, onJoined, onLeft, onError]);

  useEffect(() => {
    if (!callFrame || !roomUrl || !token || joinedRef.current) {
      return;
    }

    joinedRef.current = true;

    callFrame
      .join({
        url: roomUrl,
        token,
      })
      .catch((error) => {
        joinedRef.current = false;
        onError?.(error);
      });
  }, [callFrame, roomUrl, token, onError]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '600px',
      }}
    />
  );
}

export default VideoRoom;
