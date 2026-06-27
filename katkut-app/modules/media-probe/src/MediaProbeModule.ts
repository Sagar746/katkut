import { NativeModule, requireNativeModule } from 'expo';
import { MediaProbeResult } from './MediaProbe.types';

declare class MediaProbeModule extends NativeModule<{}> {
  probe(uri: string): Promise<MediaProbeResult>;
}

export default requireNativeModule<MediaProbeModule>('MediaProbe');
