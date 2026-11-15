import { pickToDeactivate } from '../utils/scheduledChange.utils';

const users = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('pickToDeactivate', () => {
  it('switches off nobody when the clinic is within the new limit', () => {
    expect(pickToDeactivate(users, 0, [])).toEqual([]);
  });

  it('switches off the accounts the Admin did not keep', () => {
    expect(pickToDeactivate(users, 2, ['a', 'b'])).toEqual(['c', 'd']);
  });

  it('reaches kept accounts only when there are more to cut than not kept', () => {
    expect(pickToDeactivate(users, 3, ['a', 'b'])).toEqual(['c', 'd', 'a']);
  });

  it('follows the list order when nobody was chosen', () => {
    expect(pickToDeactivate(users, 1, [])).toEqual(['a']);
  });
});
