import { registerWebModule, NativeModule } from 'expo';

// MediaProbeModule is not available on the web platform.
class MediaProbeModule extends NativeModule<{}> {}

export default registerWebModule(MediaProbeModule, 'MediaProbeModule');
