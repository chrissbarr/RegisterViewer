import { AnnouncerProvider } from './components/common/announcer';
import { AppLoader } from './components/app-loader';

export default function App() {
  return (
    <AnnouncerProvider>
      <AppLoader />
    </AnnouncerProvider>
  );
}
