/**
 * Tags a small pinchable sphere sitting at the midpoint of a
 * 'suggested' edge. Pinching it confirms that AI-suggested connection.
 */
import { createComponent, Types } from '@iwsdk/core';

export const ConfirmMarker = createComponent('ConfirmMarker', {
  edgeId: { type: Types.String, default: '' },
});
