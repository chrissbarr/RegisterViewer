import { MotionConfig } from 'motion/react';
import { AnnouncerProvider } from './components/common/announcer';
import { AppLoader } from './components/app-loader';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AnnouncerProvider>
        <AppLoader />
      </AnnouncerProvider>
    </MotionConfig>
  );
}
